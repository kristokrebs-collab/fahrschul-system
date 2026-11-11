/**
 * Where the Zeitmaschine of the Handelsplan gets the history of a market from – one door, two sources:
 *
 *  - crypto: the Labor's loader (`loadLabData`: Binance USDⓈ-M, cache first, only closed candles) – unchanged;
 *  - stocks: the stock data contract (`@/market/stocks`: ok | stale | unavailable with a reason, source and stand), hourly and
 *    daily candles as far back as the source reaches (Yahoo: 2 years of hours, 5 years of days).
 *
 * Both hand back CLOSED candles only, and for a plan that lies in the past only candles that were closed before the plan existed:
 * the Zeitmaschine never sees the future of its own plan. Fewer than `MIN_POOL_BARS` candles are a reason, not a result. Nothing
 * is invented, nothing is sent.
 */
import { HIST_MS, HIST_SOURCE, type HistInterval } from "@/domain/backtest/types";
import { MIN_POOL_BARS, type TmInterval, type TmOptions } from "@/domain/timemachine";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { nyParts, sessionOf } from "@/market/stocks/session";
import { SOURCE_NAME, type StockDataContract } from "@/market/stocks/types";
import { loadErrorKind, loadLabData } from "@/views/labor/historySource";
import { LABOR } from "@/views/labor/strings";
import { HISTORY_DAYS } from "./tradePlan";
import type { TimeMachineCandle } from "./types";

export type HistoryMarket = "crypto" | "stocks";

/** One candle length a source can offer for a plan. */
export interface HistoryChoice {
  id: TmInterval;
  /** name on the button ("Stunden-Kerzen") */
  label: string;
  /** how far back the source goes for it, in words ("bis zu 2 Jahre") */
  reach: string;
}

export interface HistoryRequest {
  symbol: string;
  interval: TmInterval;
  signal: AbortSignal;
  /** only candles that closed at or before this instant (ms) */
  until: number;
  onProgress?: (done: number, total: number) => void;
}

export type HistoryResult =
  | { ok: true; candles: TimeMachineCandle[]; fetchedAt: number; sourceLabel: string; interval: TmInterval; notes: string[] }
  | { ok: false; message: string };

export interface HistoryPlan {
  /** candle length of the plan (ms) */
  intervalMs: number;
  sessionOpenMs: number;
  sessionCloseMs: number;
  entryAt: number | null;
  flatByMs: number | null;
  /** the clock (ms) */
  now: number;
  /** the session is over: a look back */
  past: boolean;
}

/** What the card needs besides the candles. */
export interface TmSetup {
  options: Partial<TmOptions>;
  startMs: number | null;
  /** sentences above the plan line of the card */
  note: string;
}

export interface HistorySource {
  market: HistoryMarket;
  /** "Binance USDⓈ-M" / "Yahoo Finance (inoffiziell)" */
  label: string;
  /** the candle lengths offered for a plan candle length (the first is the default) and a sentence about the choice */
  choices(intervalMs: number): { choices: HistoryChoice[]; hint: string };
  /** history may reach up to this instant */
  until(plan: HistoryPlan): number;
  /** the sentence before the click: what will be loaded */
  announce(choice: HistoryChoice): string;
  load(req: HistoryRequest): Promise<HistoryResult>;
  setup(choice: HistoryChoice, plan: HistoryPlan, count: number): TmSetup;
}

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });

// ---------------------------------------------------------------------------------------------------- crypto

/** The Labor loads 15m and up; a 5-minute plan is replayed on 15-minute candles (said in the text). */
export function cryptoInterval(intervalMs: number): { iv: HistInterval; exact: boolean } {
  const exact = (Object.keys(HIST_MS) as HistInterval[]).find((k) => HIST_MS[k] === intervalMs);
  if (exact) return { iv: exact, exact: true };
  return { iv: "15m", exact: false };
}

export const CRYPTO_LABEL = "Binance USDⓈ-M";
const cryptoDays = (iv: HistInterval): number => HISTORY_DAYS[HIST_SOURCE[iv] as keyof typeof HISTORY_DAYS];

export const cryptoHistory: HistorySource = {
  market: "crypto",
  label: CRYPTO_LABEL,
  choices(intervalMs) {
    const { iv, exact } = cryptoInterval(intervalMs);
    return { choices: [{ id: iv, label: iv, reach: `bis zu ${cryptoDays(iv)} Tage` }], hint: exact ? "" : " Das Labor lädt keine kürzeren Kerzen als 15 Minuten, darum läuft der Plan auf 15-Minuten-Kerzen." };
  },
  until: (p) => p.now,
  announce: (choice) => `Dafür lädt sie bis zu ${cryptoDays(choice.id as HistInterval)} Tage ${choice.id}-Kerzen von der Börse (${CRYPTO_LABEL}); erst nach deinem Klick.`,
  async load(req) {
    const iv = req.interval as HistInterval;
    const now = Date.now();
    try {
      const res = await loadLabData({ symbol: req.symbol, intervals: [iv], from: now - cryptoDays(iv) * 86_400_000, to: now, funding: false, signal: req.signal, ...(req.onProgress ? { onProgress: req.onProgress } : {}) });
      const ms = HIST_MS[iv];
      const candles: TimeMachineCandle[] = (res.data[iv] ?? []).filter((b) => b.t * 1000 + ms <= req.until).map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, ...(b.v != null ? { volume: b.v } : {}), closed: true }));
      if (candles.length < MIN_POOL_BARS) {
        return { ok: false, message: candles.length ? `Für ${req.symbol} gibt es auf dem ${iv}-Chart nur ${candles.length} Kerzen – mindestens ${MIN_POOL_BARS} sind nötig.` : `Für ${req.symbol} liefert die Börse hier keine Kerzen.` };
      }
      return { ok: true, candles, fetchedAt: now, sourceLabel: CRYPTO_LABEL, interval: iv, notes: [] };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      const kind = loadErrorKind(e);
      return { ok: false, message: kind === "blocked" ? (IS_FILE_BUILD || isFileProtocol() ? LABOR.errors.blockedFile : LABOR.errors.blocked) : kind === "rate" ? LABOR.errors.rate : kind === "symbol" ? `Für ${req.symbol} gibt es hier keine Kerzen (die Börse kennt den Markt nicht) – die Zeitmaschine kann diesen Plan nicht durchspielen.` : "Die Kerzen konnten nicht geladen werden." };
    }
  },
  setup: (choice, _plan, count) => ({ options: {}, startMs: null, note: `Dein Handelsplan, durchgespielt auf ${count} Kerzen (${choice.id}).` }),
};

// ---------------------------------------------------------------------------------------------------- stocks

export const STOCK_HISTORY_LABEL = SOURCE_NAME.yahoo ?? "Yahoo Finance (inoffiziell)";
const HOUR = 3_600_000;
/** Yahoo's reach per candle length, in the range words the stock contract knows. */
const STOCK_RANGE = { "1h": "2y", "1d": "5y" } as const;
const STOCK_CHOICES: readonly HistoryChoice[] = [
  { id: "1h", label: "Stunden-Kerzen", reach: "bis zu 2 Jahre" },
  { id: "1d", label: "Tages-Kerzen", reach: "bis zu 5 Jahre" },
];
/** A trading week: the time stop of a replay on daily candles. */
export const STOCK_DAILY_HORIZON = 5;

/** When a source candle ended: its interval, but never later than the close of its session (the last hour of a day is 30 minutes long). */
export function stockCloseOf(time: number, interval: "1h" | "1d"): number {
  const s = sessionOf(nyParts(time).date);
  if (interval === "1d") return s ? s.closeMs : time + 24 * HOUR;
  const end = time + HOUR;
  return s ? Math.min(end, s.closeMs) : end;
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const clockNy = (ms: number): string => new Intl.DateTimeFormat("de-DE", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

/** The stock history source; `data` is the stock data contract (the app's instance, or a fake in tests). */
export function stocksHistory(data: () => Promise<StockDataContract> | StockDataContract): HistorySource {
  return {
    market: "stocks",
    label: STOCK_HISTORY_LABEL,
    choices: () => ({ choices: [...STOCK_CHOICES], hint: " Stunden-Kerzen zeigen den Tagesverlauf, Tages-Kerzen reichen weiter zurück." }),
    // a plan from a past session may only use what was known before it: candles closed before its signal (or before the open)
    until: (p) => (p.past ? (p.entryAt ?? p.sessionOpenMs) : p.now),
    announce: (choice) => `Dafür lädt sie ${choice.label} von ${STOCK_HISTORY_LABEL} (${choice.reach}), nur bis zum Plan und ohne dessen eigenen Tag; erst nach deinem Klick.`,
    async load(req) {
      const iv = req.interval === "1d" ? "1d" : "1h";
      const res = await (await data()).bars(req.symbol, iv, { range: STOCK_RANGE[iv], signal: req.signal });
      if (req.signal.aborted || (res.status === "unavailable" && res.reason === "aborted")) throw abortError();
      if (res.status === "unavailable") return { ok: false, message: `${STOCK_HISTORY_LABEL}: ${res.message}` };
      const name = iv === "1d" ? "Tages" : "Stunden";
      const candles: TimeMachineCandle[] = res.data.candles
        .filter((c) => c.closed && stockCloseOf(c.time, iv) <= req.until)
        .map((c) => ({ time: c.time, open: round4(c.open), high: round4(c.high), low: round4(c.low), close: round4(c.close), volume: c.volume, closed: true }));
      if (candles.length < MIN_POOL_BARS) {
        return {
          ok: false,
          message: candles.length
            ? `Für ${req.symbol} liefert ${STOCK_HISTORY_LABEL} vor diesem Plan nur ${candles.length} geschlossene ${name}-Kerzen – mindestens ${MIN_POOL_BARS} sind nötig${iv === "1h" ? " (bei Stunden-Kerzen rund 29 Handelstage)" : ""}. Ein junger Börsengang hat oft zu wenig Verlauf${iv === "1h" ? "; die Tages-Kerzen reichen weiter zurück" : ""}.`
            : `Für ${req.symbol} liefert ${STOCK_HISTORY_LABEL} keine geschlossenen ${name}-Kerzen vor diesem Plan.`,
        };
      }
      const notes = res.status === "stale" ? [`Der Abruf bei ${STOCK_HISTORY_LABEL} ist fehlgeschlagen (${res.message}); gerechnet wird mit dem früher gespeicherten Stand.`] : [];
      return { ok: true, candles, fetchedAt: res.fetchedAt ?? res.receivedAt, sourceLabel: res.status === "stale" ? `${STOCK_HISTORY_LABEL} – Zwischenspeicher dieses Browsers` : STOCK_HISTORY_LABEL, interval: iv, notes };
    },
    setup(choice, p, count) {
      const lead = `Dein Handelsplan, durchgespielt auf ${count} ${choice.label} (${choice.id}).`;
      const gaps = "Handelsfreie Zeiten (Nacht, Wochenende, Feiertage) sind Lücken in den Kerzen: der Kurssprung über Nacht wird nicht in eine Sitzung übernommen. Die Tageszeit-Zuordnung rechnet in UTC – mit der Sommerzeit verschiebt sich die Börsenstunde um eine Stunde.";
      if (choice.id === "1d") {
        return {
          options: { horizon: STOCK_DAILY_HORIZON },
          startMs: null,
          note: `${lead} Eine Kerze ist ein ganzer Handelstag: die Zeitmaschine kann nicht innerhalb des Tages rechnen, sie spielt den Plan über die nächsten ${STOCK_DAILY_HORIZON} Handelstage (der Zeitstopp) und prüft Stop und Ziel je Tageskerze – berühren beide eine Kerze, zählt der Stop. ${gaps}`,
        };
      }
      // hourly candles stand on the half hour (9:30, 10:30 …): the replay starts with the hour the entry falls into and runs to "flat by"
      const end = p.flatByMs ?? p.sessionCloseMs;
      const ref = p.entryAt ?? Math.min(Math.max(p.now, p.sessionOpenMs), end);
      const start = p.sessionOpenMs + Math.max(0, Math.floor((ref - p.sessionOpenMs) / HOUR)) * HOUR;
      const horizon = Math.max(2, Math.ceil((end - start) / HOUR));
      return {
        options: { horizon },
        startMs: start,
        note: `${lead} Der Zeitstopp ist das „Flat by“ des Plans: ${horizon} Stunden-Kerzen ab ${clockNy(start)} Uhr New York (mindestens 2, so viele braucht die Rechnung). ${gaps}`,
      };
    },
  };
}

/** The app's stock history source: the stock client is imported when a stock plan is replayed, never for crypto. */
export const stockHistory: HistorySource = stocksHistory(async () => (await import("@/market/stocks/client")).stockData());

export const historySourceOf = (market: HistoryMarket | undefined): HistorySource => (market === "stocks" ? stockHistory : cryptoHistory);
