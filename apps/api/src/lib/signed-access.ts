import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * PROMPT -1 §12 – kurzlebiger, signierter Zugriff auf Dokumente.
 *
 * ## Die Zusage
 *
 * „Keine öffentlichen URLs, kurzlebiger signierter Zugriff, serverseitige
 * Rechteprüfung bei JEDEM Abruf."
 *
 * Alle drei Teile werden hier eingehalten – und der dritte ist der wichtigste:
 * **die Signatur ersetzt die Autorisierung nicht, sie ergänzt sie.** Der
 * Abrufendpunkt prüft ZUERST die Sitzung und die Berechtigung gegen die
 * Datenbank und DANN die Signatur. Eine Signatur allein öffnet nichts. Deshalb
 * ist die Signatur zusätzlich an den Benutzer gebunden (`benutzerId` geht in
 * den HMAC ein): eine an Schüler B weitergegebene URL von Schüler A ist
 * ungültig, selbst wenn B ein gültiges Dokumentrecht hätte.
 *
 * ## Warum zustandslos (HMAC) und nicht eine Token-Tabelle
 *
 * Der Finance-Export benutzt eine Tabelle (`finanz_exporte.download_token_hash`),
 * weil dort ein einmaliger Download protokolliert wird. Für Dokumente ist ein
 * Abruf nicht einmalig (Miniaturbild, Vollansicht, Neuladen), und eine Zeile je
 * Ansicht wäre reiner Ballast. Der HMAC trägt Ablauf und Bindung in sich; das
 * Audit passiert am Endpunkt, nicht am Token.
 *
 * Der Preis: eine ausgegebene Signatur kann vor Ablauf nicht widerrufen
 * werden. Deshalb ist die Lebensdauer kurz (Standard 5 Minuten) und der
 * Zweck eng (`purpose`), und der Sitzungsentzug (`POST /auth/logout-all`)
 * wirkt trotzdem sofort — weil der Endpunkt eine gültige Sitzung verlangt.
 */

export const DOCUMENT_ACCESS_TTL_MS = 5 * 60 * 1000;

export interface SignedAccessPayload {
  /** Ressourcenart, z. B. "dokument". */
  resource: string;
  resourceId: string;
  /** Der Benutzer, FÜR den die Signatur gilt. */
  benutzerId: string;
  /** Zweck, damit eine Signatur nicht auf einem anderen Endpunkt gilt. */
  purpose: "download" | "thumbnail";
  /** Ablauf als Millisekunden-Zeitstempel. */
  expiresAt: number;
}

function payloadString(p: SignedAccessPayload): string {
  return [p.resource, p.resourceId, p.benutzerId, p.purpose, String(p.expiresAt)].join("|");
}

export function signAccess(payload: SignedAccessPayload, secret: string): string {
  const mac = createHmac("sha256", secret).update(payloadString(payload)).digest("base64url");
  return `${payload.expiresAt}.${payload.purpose}.${mac}`;
}

export type SignatureFailure = "malformed" | "expired" | "invalid";

export interface VerifyResult {
  ok: boolean;
  reason?: SignatureFailure;
  expiresAt?: number;
}

/**
 * Prüft die Signatur. Reihenfolge ist Absicht: erst Form, dann Ablauf, dann
 * MAC. Ein abgelaufener Token bekommt `expired` (410 am Endpunkt) und nicht
 * `invalid` (404) – das ist für den Nutzer die hilfreichere Antwort und verrät
 * nichts, was er nicht schon wusste (er hatte den Token ja).
 */
export function verifyAccess(
  token: string,
  expected: Omit<SignedAccessPayload, "expiresAt">,
  secret: string,
  now = Date.now(),
): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [expiresRaw, purpose, mac] = parts;
  if (!/^\d+$/.test(expiresRaw)) return { ok: false, reason: "malformed" };
  const expiresAt = Number(expiresRaw);
  if (purpose !== expected.purpose) return { ok: false, reason: "invalid" };
  if (expiresAt <= now) return { ok: false, reason: "expired", expiresAt };

  const erwartet = createHmac("sha256", secret)
    .update(payloadString({ ...expected, expiresAt }))
    .digest("base64url");
  if (erwartet.length !== mac.length) return { ok: false, reason: "invalid", expiresAt };
  try {
    if (!timingSafeEqual(Buffer.from(erwartet), Buffer.from(mac))) {
      return { ok: false, reason: "invalid", expiresAt };
    }
  } catch {
    return { ok: false, reason: "invalid", expiresAt };
  }
  return { ok: true, expiresAt };
}

export function documentDownloadUrl(input: {
  dokumentId: string;
  benutzerId: string;
  secret: string;
  ttlMs?: number;
  now?: number;
}): { url: string; expiresAt: string } {
  const expiresAt = (input.now ?? Date.now()) + (input.ttlMs ?? DOCUMENT_ACCESS_TTL_MS);
  const signature = signAccess(
    {
      resource: "dokument",
      resourceId: input.dokumentId,
      benutzerId: input.benutzerId,
      purpose: "download",
      expiresAt,
    },
    input.secret,
  );
  return {
    url: `/documents/${input.dokumentId}/content?sig=${encodeURIComponent(signature)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/** HTTP-Status je Signaturfehler. */
export function statusForSignatureFailure(reason: SignatureFailure): number {
  return reason === "expired" ? 410 : 403;
}
