/**
 * The two consents of the order (B4) as DATA, shared by the order sheet (what the person reads and ticks) and the server
 * (what it stores as evidence): the exact wording, a version label and the SHA-256 of that wording. PURE (no React, no `@/`
 * alias): the Netlify functions import it by relative path.
 *
 * Evidence = who (account), when (server clock), what (the wording itself + its hash + the version) – kept on the server in
 * `public.consents` (migration 0016, RLS: only the own rows are readable) and in the metadata of the Stripe Checkout Session.
 * The browser sends only the hash of what it SHOWED; the server compares it with the wording it knows and refuses an order
 * whose displayed text is not the current one (`consent_outdated`). ALL WORDINGS ARE DRAFTS – „Entwurf – Anwalt prüft“.
 */
import { IMMEDIATE_START_CONSENT } from "./consentTexts";

export const CONSENT_KINDS = ["terms", "immediate_start"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** Bump with every change of a wording below (it is part of the hash anyway; the label is for humans reading the table). */
export const CONSENT_TEXT_VERSION = "2026-11-07-entwurf";

/** The AGB box, in the parts the sheet fills with links (AGB · Widerrufsbelehrung · Datenschutzerklärung). */
export const TERMS_PARTS = {
  pre: "Ich akzeptiere die ",
  agb: "AGB",
  mid: " des Betreibers und habe die ",
  widerruf: "Widerrufsbelehrung",
  mid2: " und die ",
  datenschutz: "Datenschutzerklärung",
  post: " zur Kenntnis genommen.",
} as const;

export const TERMS_CONSENT = Object.values(TERMS_PARTS).join("");

export const CONSENT_TEXT: Readonly<Record<ConsentKind, string>> = {
  terms: TERMS_CONSENT,
  immediate_start: IMMEDIATE_START_CONSENT,
};

/** The canonical string that is hashed: kind, version and wording – nothing else, so client and server agree byte for byte. */
export function consentCanonical(kind: ConsentKind): string {
  return `${kind}\n${CONSENT_TEXT_VERSION}\n${CONSENT_TEXT[kind]}`;
}

/** One string over both consents (what the order hashes and the server checks). */
export function consentSetCanonical(): string {
  return CONSENT_KINDS.map(consentCanonical).join("\n---\n");
}

/** Lower-case hex SHA-256 (Web Crypto: browsers, Node 20+, the Netlify runtime). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const consentSetHash = (): Promise<string> => sha256Hex(consentSetCanonical());
export const consentHash = (kind: ConsentKind): Promise<string> => sha256Hex(consentCanonical(kind));

/** `order_id` of an order (the idempotency key of the checkout): a UUID the browser makes once per order. */
export const ORDER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newOrderId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
