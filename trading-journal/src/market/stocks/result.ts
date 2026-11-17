/**
 * Constructors and wording for `StockResult`. A failure is a value with a reason in German – the views print `message`
 * and decide by `reason`; nothing here guesses or fills in.
 */
import type { Stamp, StockResult, UnavailableReason } from "./types";

export const REASON_TEXT: Readonly<Record<UnavailableReason, string>> = {
  "no-server": "Die Server-Funktionen für Aktien-Daten sind auf dieser Seite nicht eingerichtet.",
  offline: "Das Gerät ist offline.",
  network: "Der Server ist gerade nicht erreichbar.",
  timeout: "Die Quelle antwortet nicht rechtzeitig.",
  login: "Für die Aktien-Daten bitte anmelden.",
  plan: "Die Aktien-Daten sind in deinem Tarif nicht enthalten.",
  "rate-limited": "Die Quelle oder der Server begrenzt die Abrufe gerade. Bitte in einigen Minuten erneut versuchen.",
  blocked: "Die Quelle verweigert die Abrufe dieses Servers. Sie ist inoffiziell und kann ohne Vorwarnung sperren.",
  upstream: "Die Quelle ist gerade nicht erreichbar oder meldet einen Fehler.",
  "bad-symbol": "Dieses Kürzel kennt die Quelle nicht.",
  "no-data": "Für dieses Kürzel liegen keine Daten vor.",
  "bad-response": "Die Antwort hatte ein unerwartetes Format.",
  aborted: "Abgebrochen.",
};

export const ok = <T>(data: T, stamp: Stamp): StockResult<T> => ({ status: "ok", data, ...stamp });

export const stale = <T>(data: T, stamp: Stamp, reason: UnavailableReason, message: string, failedAt: number): StockResult<T> => ({ status: "stale", data, reason, message, failedAt, ...stamp });

export const unavailable = <T>(reason: UnavailableReason, at: number, message?: string, source?: string): StockResult<T> => ({
  status: "unavailable",
  reason,
  message: message?.trim() || REASON_TEXT[reason],
  at,
  ...(source ? { source } : {}),
});

/** The data of a result, `null` when there is none (`stale` still has data). */
export function dataOf<T>(r: StockResult<T> | undefined): T | null {
  return r && r.status !== "unavailable" ? r.data : null;
}

/** The result with its stamp as a plain stamp (for `SourceStand`), `null` for an unavailable one. */
export function stampOf<T>(r: StockResult<T> | undefined): Stamp | null {
  if (!r || r.status === "unavailable") return null;
  return { source: r.source, asOf: r.asOf, receivedAt: r.receivedAt, ...(r.fetchedAt != null ? { fetchedAt: r.fetchedAt } : {}) };
}
