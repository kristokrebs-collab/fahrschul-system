/**
 * What the Congress client answers: `ok | stale | unavailable(reason)`, the same three-way result as the stock data contract
 * (`@/market/stocks`), with two reasons of its own – `format` (the Clerk's file or form no longer has the shape the reader knows)
 * and `no-index` (the Clerk has no index for that year yet). A failure is a value with a reason in German; nothing is invented.
 */
import { REASON_TEXT as STOCK_REASON_TEXT } from "../stocks/result";
import type { UnavailableReason } from "../stocks/types";

export type CongressReason = UnavailableReason | "format" | "no-index";

export const CONGRESS_REASON_TEXT: Readonly<Record<CongressReason, string>> = {
  ...STOCK_REASON_TEXT,
  "no-server": "Die Server-Funktionen für den Kongress-Tracker sind auf dieser Seite nicht eingerichtet.",
  login: "Für die Kongress-Meldungen bitte anmelden.",
  plan: "Die Kongress-Meldungen sind in deinem Tarif nicht enthalten.",
  blocked: "Der House Clerk verweigert die Abrufe dieses Servers.",
  upstream: "Der House Clerk ist gerade nicht erreichbar oder meldet einen Fehler. Das ist eine Behördenseite ohne Zusage zur Erreichbarkeit.",
  timeout: "Der House Clerk antwortet nicht rechtzeitig.",
  format: "Die Datei oder das Formular des House Clerk hat nicht mehr den Aufbau, den der Tracker kennt. Es wird nichts geraten.",
  "no-index": "Der House Clerk hat für dieses Jahr noch keinen Index veröffentlicht.",
};

/** Where a value comes from and when. */
export interface CongressStamp {
  source: "house-clerk";
  /** the time the data refers to (the index file's time); `null` = the source did not say */
  asOf: number | null;
  /** when this app received it */
  receivedAt: number;
  /** when the server read it from the Clerk (a cached server answer is older than `receivedAt`) */
  fetchedAt: number;
}

export type CongressResult<T> =
  | ({ status: "ok"; data: T } & CongressStamp)
  | ({ status: "stale"; data: T; reason: CongressReason; message: string; failedAt: number } & CongressStamp)
  | { status: "unavailable"; reason: CongressReason; message: string; at: number };

export const okResult = <T>(data: T, stamp: CongressStamp): CongressResult<T> => ({ status: "ok", data, ...stamp });
export const staleResult = <T>(data: T, stamp: CongressStamp, reason: CongressReason, message: string, failedAt: number): CongressResult<T> => ({ status: "stale", data, reason, message, failedAt, ...stamp });
export const unavailableResult = <T>(reason: CongressReason, at: number, message?: string): CongressResult<T> => ({ status: "unavailable", reason, message: message?.trim() || CONGRESS_REASON_TEXT[reason], at });

export const dataOf = <T>(r: CongressResult<T> | undefined): T | null => (r && r.status !== "unavailable" ? r.data : null);
