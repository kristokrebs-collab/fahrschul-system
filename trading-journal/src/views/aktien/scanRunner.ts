/**
 * One scan run of the Aktien page, from the user's choices to a result: builds the list of charts (directory block,
 * watchlist, typed tickers, crypto top-N – each with its honest failure), picks the data source and the setups, runs the
 * kernel (`@/domain/scanner`) and returns the outcome plus what the page needs to say about it ("Block 3 von 41", the
 * trading day an opening range belongs to, the stand of the directory). No React, no store – the store only calls this.
 */
import { clampCap, runScan, stockUniverse, type MarketKind, type ScanMode, type ScanOutcome, type ScanParams, type ScanProgress, type ScanSource, type ScanTarget, type SetupId, type StockSource } from "@/domain/scanner";
import { cryptoClient as sharedCryptoClient, stockScanSource, type CryptoClient } from "@/market/stocks/scanSources";
import { stockData } from "@/market/stocks/client";
import { currentTradingDay, isSessionOpen, nyParts } from "@/market/stocks/session";
import type { Stamp, StockDataContract, SymbolDirectory, UnavailableReason } from "@/market/stocks/types";

export interface DailyPick {
  flag: boolean;
  rsi: boolean;
}

/** The user's choices (what the page stores per device). */
export interface ScanPrefs {
  market: MarketKind;
  mode: ScanMode;
  daily: DailyPick;
  stock: { source: StockSource; cap: number; block: number; custom: string };
  crypto: { top: number };
  rank: "turnover" | "metric" | "symbol";
}

export const DEFAULT_PREFS: ScanPrefs = {
  market: "stock",
  mode: "daily",
  daily: { flag: true, rsi: true },
  stock: { source: "directory", cap: 100, block: 1, custom: "" },
  crypto: { top: 30 },
  rank: "turnover",
};

export interface RunMeta {
  market: MarketKind;
  mode: ScanMode;
  setups: SetupId[];
  /** the thresholds this run used (frozen: the panel may change them afterwards) */
  params: ScanParams;
  /** charts that exist in the chosen source */
  available: number;
  cap: number;
  block: number;
  blocks: number;
  source: StockSource | "crypto-top";
  /** stand of the directory / the crypto ticker list the charts were taken from */
  universeStamp: Stamp | null;
  /** the candle length ("1d", "5m", "15m") */
  interval: string;
  /** one sentence about the session the opening range belongs to */
  sessionNote: string | null;
  /** typed tickers that are no ticker */
  invalid: string[];
  /** tickers the directory does not list (they are scanned anyway) */
  unlisted: string[];
}

export type RunResult =
  | { ok: true; outcome: ScanOutcome; meta: RunMeta }
  | { ok: false; stage: "universe"; reason: UnavailableReason; message: string }
  | { ok: false; stage: "empty"; message: string };

export interface RunDeps {
  data?: StockDataContract;
  crypto?: CryptoClient;
  now?: () => number;
  /** fixture hook: a source other than the real one (tests) */
  stockSource?: (mode: ScanMode) => ScanSource;
}

export const setupsOf = (mode: ScanMode, pick: DailyPick): SetupId[] => (mode === "orb" ? ["orb"] : ([pick.flag ? "flag" : null, pick.rsi ? "rsi" : null].filter(Boolean) as SetupId[]));

const WEEKDAY = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const dayText = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.`;
};

/** What to tell about the session an opening range is read on. */
export function sessionNote(market: MarketKind, now: number): string {
  if (market === "crypto") return `Krypto läuft rund um die Uhr: die „Eröffnung“ ist der Tagesbeginn 00:00 UTC (${dayText(new Date(now).toISOString().slice(0, 10))}).`;
  const day = currentTradingDay(now);
  const today = nyParts(now).date;
  if (isSessionOpen(now)) return `Handelstag ${dayText(day.date)} (New York, Markt geöffnet) – die Kerzen reichen bis zur letzten vollständigen.`;
  return day.date === today ? `Handelstag ${dayText(day.date)} (New York, Markt noch nicht geöffnet oder schon zu).` : `Markt geschlossen – gelesen wird der letzte Handelstag: ${dayText(day.date)} (New York).`;
}

export async function prepareAndRun(prefs: ScanPrefs, params: ScanParams, watchlistStocks: readonly string[], signal: AbortSignal, onProgress: (p: ScanProgress) => void, deps: RunDeps = {}): Promise<RunResult> {
  const now = deps.now ?? Date.now;
  const setups = setupsOf(prefs.mode, prefs.daily);
  if (!setups.length) return { ok: false, stage: "empty", message: "Wähle mindestens ein Setup: Flagge oder RSI-Erholung." };

  let targets: ScanTarget[];
  let available: number;
  let blocks = 1;
  let block = 1;
  let universeStamp: Stamp | null = null;
  let invalid: string[] = [];
  let unlisted: string[] = [];
  let source: ScanSource;
  let sourceKind: RunMeta["source"];
  const cap = clampCap(prefs.market === "crypto" ? prefs.crypto.top : prefs.stock.cap);

  if (prefs.market === "crypto") {
    const crypto = deps.crypto ?? sharedCryptoClient();
    const top = await crypto.top(cap, signal);
    if (!top.ok) return { ok: false, stage: "universe", reason: top.reason, message: `Die Liste der Krypto-Märkte konnte nicht geladen werden: ${top.message}` };
    targets = top.targets;
    available = top.targets.length;
    universeStamp = top.stamp;
    source = crypto.source(prefs.mode);
    sourceKind = "crypto-top";
  } else {
    const data = deps.data ?? stockData();
    sourceKind = prefs.stock.source;
    let directory: SymbolDirectory | null = null;
    const dir = await data.symbols({ signal });
    if (dir.status !== "unavailable") {
      directory = dir.data;
      universeStamp = { source: dir.source, asOf: dir.asOf, receivedAt: dir.receivedAt, ...(dir.fetchedAt != null ? { fetchedAt: dir.fetchedAt } : {}) };
    } else if (prefs.stock.source === "directory") {
      return { ok: false, stage: "universe", reason: dir.reason, message: `Das Symbolverzeichnis konnte nicht geladen werden: ${dir.message}` };
    }
    const u = stockUniverse({ source: prefs.stock.source, cap, block: prefs.stock.block, custom: prefs.stock.custom }, directory?.entries ?? null, watchlistStocks);
    targets = u.targets;
    available = u.available;
    blocks = u.blocks;
    block = Math.min(u.blocks, Math.max(1, prefs.stock.block));
    invalid = u.invalid;
    unlisted = u.unlisted;
    source = deps.stockSource ? deps.stockSource(prefs.mode) : stockScanSource(prefs.mode, data);
  }
  if (!targets.length) {
    return { ok: false, stage: "empty", message: prefs.market === "stock" && prefs.stock.source === "watchlist" ? "Auf deiner Watchlist stehen keine Aktien. Füge unten welche hinzu oder wähle eine andere Quelle." : prefs.market === "stock" && prefs.stock.source === "custom" ? "Gib mindestens ein gültiges US-Kürzel ein (z. B. AAPL, MSFT)." : "Es gibt nichts zu scannen." };
  }
  const outcome = await runScan({ source, targets, params, setups, signal, onProgress, now });
  return {
    ok: true,
    outcome,
    meta: { market: prefs.market, mode: prefs.mode, setups, params, available, cap, block, blocks, source: sourceKind, universeStamp, interval: source.interval, sessionNote: prefs.mode === "orb" ? sessionNote(prefs.market, now()) : null, invalid, unlisted },
  };
}
