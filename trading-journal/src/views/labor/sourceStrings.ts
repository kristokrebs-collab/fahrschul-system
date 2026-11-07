/**
 * German copy for the Labor's data source: what the loader is doing right now, why a source did not deliver, and the
 * honest note under a result that did NOT come from Binance-Futures. Pure functions of `historySource.ts` types.
 */
import type { FailureReason } from "@/market/types";
import { HISTORY_SOURCES, HISTORY_TIMING, type HistorySource, type LoadStatus, type StageFailure } from "./historySource";

/** Name of a source in a list or after a colon. */
export const SOURCE_NAME: Readonly<Record<HistorySource, string>> = {
  binance: "Binance-Futures",
  proxy: "EU-Proxy",
  bybit: "Bybit",
  spot: "Binance Spot",
  "spot-app": "Binance Spot über die App",
};

/** … as the object of "Frage …" (Akkusativ) and after "bei …" / "mit …" (Dativ), and at the start of a sentence. */
const ACC: Readonly<Record<HistorySource, string>> = { ...SOURCE_NAME, proxy: "den EU-Proxy der App" };
const DAT: Readonly<Record<HistorySource, string>> = { ...SOURCE_NAME, proxy: "dem EU-Proxy der App" };
const SUBJECT: Readonly<Record<HistorySource, string>> = { ...SOURCE_NAME, proxy: "Der EU-Proxy" };

/** Why a request failed, in a few plain words (no sentence end). */
export function reasonText(kind: FailureReason, timeoutMs: number = HISTORY_TIMING.timeoutMs): string {
  switch (kind) {
    case "timeout":
      return `keine Antwort in ${Math.max(1, Math.round(timeoutMs / 1000))} s`;
    case "network":
      return "nicht erreichbar";
    case "cors":
      return "vom Browser blockiert";
    case "blocked_451":
      return "für diese Region gesperrt (HTTP 451)";
    case "rate_limited":
      return "lehnt ab (zu viele Anfragen oder gesperrt)";
    case "http_5xx":
      return "Serverfehler oder unbrauchbare Antwort";
    case "offline":
      return "keine Internetverbindung";
    case "bad_symbol":
      return "kennt den Markt nicht";
    default:
      return "hat nicht geantwortet";
  }
}

/** The status line while the candles load: which source is asked, which attempt, what comes next. */
export function statusText(s: LoadStatus): string {
  switch (s.step) {
    case "request":
      return `${s.attempt > 1 ? `${s.attempt}. Versuch bei ${DAT[s.source]} …` : `Frage ${ACC[s.source]} …`}${s.prev ? ` (vorher ${SOURCE_NAME[s.prev.source]}: ${reasonText(s.prev.kind, s.prev.limitMs)})` : ""}`;
    case "retry":
      return `${SUBJECT[s.source]}: ${reasonText(s.reason)}. Neuer Versuch in ${Math.max(1, Math.round(s.inMs / 1000))} s …`;
    case "switch": {
      const next = HISTORY_SOURCES[s.to];
      const tail = next.futures ? `Weiter mit ${DAT[s.to]} …` : `Weiter mit ${DAT[s.to]} (Ausweichquelle) …`;
      return `${SUBJECT[s.from]}: ${reasonText(s.reason)}. ${tail}`;
    }
    case "budget":
      return `Wartet auf das Abruf-Limit (${Math.max(1, Math.round(s.inMs / 1000))} s) …`;
  }
}

/** The reason in two words (the list in the error card is small). */
function reasonShort(kind: FailureReason): string {
  switch (kind) {
    case "timeout":
      return "Zeitlimit";
    case "network":
      return "nicht erreichbar";
    case "cors":
      return "Browser-Sperre";
    case "blocked_451":
      return "Region gesperrt (451)";
    case "rate_limited":
      return "abgelehnt";
    case "http_5xx":
      return "Serverfehler";
    case "offline":
      return "offline";
    default:
      return "keine Antwort";
  }
}

const LIST_NAME: Readonly<Record<HistorySource, string>> = { binance: "Futures", proxy: "EU-Proxy", bybit: "Bybit", spot: "Spot", "spot-app": "Spot über die App" };

/** One short line for the error card: every source that was asked and why it did not deliver ("Futures: Zeitlimit · EU-Proxy: Region gesperrt (451) · …"). */
export function failureDetail(failures: readonly StageFailure[]): string | null {
  if (!failures.length) return null;
  return failures.map((f) => `${LIST_NAME[f.source]}: ${reasonShort(f.kind)}${f.skipped ? " (gerade erst, nicht erneut gefragt)" : ""}`).join(" · ");
}

/**
 * The note under a finished run whose candles did NOT come from Binance-Futures (null when they did, the EU proxy
 * included – that is the same series). Says what was used, why, and what that means for the numbers.
 */
export function sourceNote(source: HistorySource, failed: readonly StageFailure[]): string | null {
  const info = HISTORY_SOURCES[source];
  if (info.futures) return null;
  const why = failed.length ? ` (${failed.map((f) => `${SOURCE_NAME[f.source]}: ${reasonText(f.kind, f.limitMs)}`).join(", ")})` : "";
  if (info.market === "spot") {
    return `Quelle: Spot, nicht Futures. Binance-Futures war nicht erreichbar${why}. Spot-Preise und -Kerzen weichen vom Futures-Markt ab, Spot kennt kein Funding und keinen Hebel. Das Ergebnis passt nicht 1:1 zu Futures-Trades.`;
  }
  return `Quelle: Bybit, nicht Binance. Binance-Futures war nicht erreichbar${why}. Ein anderer Markt: Kerzen und Preise weichen leicht ab, die Funding-Historie von Binance fehlt (Annahme statt Historie).`;
}

/** Wording of the data in the first line of the assumptions ("… Kerzen BTCUSDT von <this>, …"). */
export function assumptionSource(source: HistorySource): string {
  switch (source) {
    case "binance":
      return "Binance-Futures";
    case "proxy":
      return "Binance-Futures (über den EU-Proxy der App)";
    case "bybit":
      return "Bybit (USDT-Perp, nicht Binance)";
    case "spot":
    case "spot-app":
      return "Binance Spot, nicht Futures";
  }
}

/** Badge text for the comparison of runs and the reference label (null for Binance-Futures). */
export const sourceBadge = (source: HistorySource | undefined): string | null => (source && !HISTORY_SOURCES[source].futures ? HISTORY_SOURCES[source].short : null);
