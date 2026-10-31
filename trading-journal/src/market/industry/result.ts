/**
 * What the industry-data client answers: `ok | stale | unavailable(reason)` – the same three-way result as the stock and Congress
 * clients, with one reason of its own: `format` (the library's file no longer has the shape the reader knows). A failure is a value
 * with a reason in German; nothing is invented, and a copy kept on the device is shown as a copy, with its own stand.
 */
import type { IndustryDataset } from "@/domain/industryTrend";
import { REASON_TEXT as STOCK_REASON_TEXT } from "../stocks/result";
import type { UnavailableReason } from "../stocks/types";

export type IndustryReason = UnavailableReason | "format";

export const INDUSTRY_REASON_TEXT: Readonly<Record<IndustryReason, string>> = {
  ...STOCK_REASON_TEXT,
  "no-server": "Die Server-Funktion für die Branchendaten ist auf dieser Seite nicht eingerichtet. Ohne sie lädt die App die Ken-French-Datei nicht; die Ergebnis-Auswertung unten geht trotzdem.",
  login: "Für die Branchendaten bitte anmelden.",
  plan: "Die Branchendaten sind in deinem Tarif nicht enthalten.",
  blocked: "Die Datenbibliothek verweigert die Abrufe dieses Servers.",
  upstream: "Die Ken-French-Datenbibliothek ist gerade nicht erreichbar oder meldet einen Fehler. Es ist eine Hochschul-Webseite ohne Zusage zur Erreichbarkeit.",
  timeout: "Die Ken-French-Datenbibliothek antwortet nicht rechtzeitig.",
  format: "Die Datei der Ken-French-Bibliothek hat nicht mehr den Aufbau, den die App kennt. Es werden keine Zahlen geraten.",
  "bad-response": "Die Antwort des Servers war beschädigt oder hatte ein unerwartetes Format.",
};

/** Where the data comes from and when. */
export interface IndustryStamp {
  source: "ken-french";
  /** the last trading day in the data (`YYYYMMDD`) */
  asOf: number;
  /** the CRSP database the file was made from (`202609`), `null` = the header did not say */
  database: string | null;
  /** the file's own time (ms epoch), `null` = the library did not say */
  fileTime: number | null;
  /** when this app received it */
  receivedAt: number;
  /** when the server read it from the library (a cached server answer is older than `receivedAt`) */
  fetchedAt: number;
}

export type IndustryResult =
  | ({ status: "ok"; data: IndustryDataset } & IndustryStamp)
  | ({ status: "stale"; data: IndustryDataset; reason: IndustryReason; message: string; failedAt: number } & IndustryStamp)
  | { status: "unavailable"; reason: IndustryReason; message: string; at: number };

export const okResult = (data: IndustryDataset, stamp: IndustryStamp): IndustryResult => ({ status: "ok", data, ...stamp });
export const staleResult = (data: IndustryDataset, stamp: IndustryStamp, reason: IndustryReason, message: string, failedAt: number): IndustryResult => ({ status: "stale", data, reason, message, failedAt, ...stamp });
export const unavailableResult = (reason: IndustryReason, at: number, message?: string): IndustryResult => ({ status: "unavailable", reason, message: message?.trim() || INDUSTRY_REASON_TEXT[reason], at });
