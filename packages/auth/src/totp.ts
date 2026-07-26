import { authenticator } from "otplib";

/**
 * Server-seitige TOTP-MFA für Mitarbeitendenrollen (Büro, Finanzen,
 * Geschäftsführung, Systemdienst — kein externer SMS-/E-Mail-Anbieter
 * nötig, siehe docs/integration-gaps.md). Schüler/Fahrlehrer können MFA
 * optional aktivieren, es ist für sie nicht verpflichtend vorgeschrieben.
 */

authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildTotpOtpAuthUrl(params: {
  secret: string;
  accountEmail: string;
  issuer: string;
}): string {
  return authenticator.keyuri(params.accountEmail, params.issuer, params.secret);
}

/**
 * Erzeugt den aktuell gültigen Token zu einem Secret.
 *
 * Ausschließlich für BETRIEBS- und MESSWERKZEUGE gedacht, die sich mit einem
 * Dienstkonto anmelden müssen (`scripts/slo-measure.mjs`, §21) – und für Tests.
 * Es gibt keinen Aufrufer in `apps/api`: der Server PRÜFT Token, er erzeugt
 * keine. Die Funktion liegt hier und nicht im Skript, damit ein Werkzeug nicht
 * `otplib` direkt einbinden und damit eine zweite TOTP-Konfiguration
 * (Zeitfenster, Ziffernzahl) neben dieser aufmachen muss.
 */
export function generateTotpToken(secret: string): string {
  return authenticator.generate(secret);
}

export function verifyTotpToken(token: string, secret: string): boolean {
  try {
    return authenticator.check(token, secret);
  } catch {
    return false;
  }
}

export const STAFF_ROLES_REQUIRING_MFA = [
  "buero",
  "finanzen",
  "geschaeftsfuehrung",
  "systemdienst",
] as const;
