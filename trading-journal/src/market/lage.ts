/**
 * Live Lage-Ampel (decision 23): `useLage()` / `getLage()` / `subscribeLage()` / `retainLage()`.
 *
 * Inputs (all from the market provider, nothing fetched here)
 * - 1D: the provider's REST feed `kline_1d` (`DAILY_FEED`, see `feeds.ts`): cached in IndexedDB, 1000 days on a fresh
 *   start only, then the missing days hourly at hh:00:20 on the Binance clock (00:00:20 brings the closed day), stale
 *   after 25 h, watched / resumed like every REST feed. Only candles that had CLOSED when Binance answered count (a
 *   forming day fetched at 23:00 never reads as the 00:00 close).
 * - The just-closed day without its 1D candle (the 00:00:20 poll and its retries failed, or the first seconds after
 *   00:00): built from the day's 24 closed 1H candles (`dailyFromHourly`: first open, max high, min low, last 1H close
 *   — the same Binance trades as the 1D candle) and used for the Lage and the gate until the 1D candle arrives and
 *   replaces it; the status says so after 5 min (`LAGE_DERIVED_TEXT`). Not all 24 there / closed → the honest status
 *   as before ("Tagesschluss noch nicht geladen", the Lage of the day before), and once the close has been missing
 *   for more than an hour after 00:00 UTC: no Lage, no gate ("keine Daten", `LAGE_NO_CLOSE_TEXT`) — never yesterday
 *   silently.
 * - 4H / 1H: the live `kline_4h` / `kline_1h` series (WS + REST bootstrap 499), closed candles only.
 * - Price: `priceMv` (freshest of trade / book / ticker), at most 1×/s; the forming 4H close stands in without it.
 *
 * Cadence (120 Hz rule): EMAs + structure (`lageBase`, ≈ 0.5 ms) run only when a closed input bar changes — or once
 * when a bar the series already report closed passes its close on the Binance clock (`provider.serverNow()`; a device
 * clock a little behind Binance receives the socket's final frame "before" the close, and the next closed-bar change
 * may be an hour away); a price move recomputes the live part (≈ 0.04 ms) at most once a second and publishes a new
 * snapshot only when a shown value changes (`lageKey`: state, signs, chips, distances at 0.1 %). Nothing runs per
 * frame, nothing while hidden.
 * Retained by subscribers (`useLage`, `retainLage`, the signal engine); with none, the listeners are off.
 */
import { useEffect, useSyncExternalStore } from "react";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { dailyFromHourly, DAY_MS, lageAt, lageBase, lageKey, type Lage, type LageBase } from "@/domain/lage";
import type { Bar } from "@/domain/signals/indicators";
import { DAILY_FEED } from "./feeds";
import { getFeed, getProvider, subscribeFeed, useProvider } from "./marketStore";
import { priceMv } from "./motionValues";
import type { MarketProvider } from "./provider";
import { SOFT_FAILURE_TEXT } from "./statusLabel";
import type { Candle, FeedHealth, Source } from "./types";

/** Days the Lage evaluates (EMA 200 settled, 500-day structure). */
export const LAGE_DAILY_LIMIT = 1000;
/** After 00:00 UTC (Binance clock) the closed day arrives this much later (the provider polls hh:00:20). */
export const LAGE_CLOSE_GRACE_MS = 20_000;
/** Live price → distances at most this often. */
export const LAGE_LIVE_MS = 1000;
/** The newest closed day may lag this long behind the last 00:00 UTC before the status says "noch nicht geladen". */
const MISSING_CLOSE_MS = 5 * 60_000;
/**
 * A daily close that is neither loaded (1D candle) nor derivable from the 24 closed 1H candles this long after
 * 00:00 UTC (Binance clock) → no Lage, no gate ("keine Daten") instead of gating with the day before.
 */
export const LAGE_NO_CLOSE_MS = 60 * 60_000;
/** Status note while the just-closed day is read from its 1H candles (the 1D candle has not arrived). */
export const LAGE_DERIVED_TEXT = "Tagesschluss aus 1H-Kerzen (1D-Kerze fehlt noch)";
/** Status note when the daily close is missing for more than `LAGE_NO_CLOSE_MS`: the Ampel holds nothing back. */
export const LAGE_NO_CLOSE_TEXT = "Tagesschluss fehlt seit über 1 h – Lage-Ampel sperrt nichts (keine Daten)";

export type LageFeedState = "idle" | "loading" | "ok" | "stale" | "error" | "offline";

export interface LageFeedStatus {
  state: LageFeedState;
  /** device time of the last daily page */
  fetchedAt: number | null;
  /** close time of the newest closed daily bar (ms, exchange time) */
  closedAt: number | null;
  /** next planned poll (device time) */
  nextAt: number | null;
  /** source of the daily bars */
  source: Source | null;
  /** German reason while failing (`Netzwerk/CORS-Fehler · 2× in Folge`) or a note (file version) */
  detail: string | null;
}

export interface LageView {
  lage: Lage | null;
  status: LageFeedStatus;
}

export const LAGE_FILE_CORS = "Datei-Version: der Browser liest die Binance-Tageskerzen evtl. nicht (CORS) – Web-Link nutzen.";
const STALE_TEXT = "Tagesschluss noch nicht geladen";
const FAIL_TEXT: Readonly<Record<string, string>> = {
  ...SOFT_FAILURE_TEXT,
  blocked_451: "Region gesperrt (451)",
  unsupported: "Quelle liefert keine Tageskerzen",
  bad_symbol: "Symbol unbekannt",
};

/**
 * The just-closed day (00:00 UTC on the Binance clock) and the daily feed: the 1D candle is REST-only (hourly poll at
 * hh:00:20, retried every 60 s after 00:00) and can be missing; the 1H series (socket) has the same day's candles.
 */
interface DailyGap {
  /** the 1D candle of the day that closed at the last 00:00 UTC is not there */
  missing: boolean;
  /** that day from its 24 closed 1H candles (`dailyFromHourly`) — used until the 1D candle arrives and replaces it */
  derived: Bar | null;
  /** missing, not derivable and more than `LAGE_NO_CLOSE_MS` past 00:00 UTC → no Lage, no gate */
  expired: boolean;
  /** when the clock alone can change this (00:00 + 1 h while waiting, else the next 00:00), Binance clock */
  decideAt: number;
}

interface Ctl {
  refs: number;
  provider: MarketProvider | null;
  offHealth: (() => void) | null;
  liveTimer: ReturnType<typeof setTimeout> | null;
  lastLive: number;
  offs: Array<() => void>;
  dKey: string;
  h4Key: string;
  h1Key: string;
  daily: Bar[];
  h4: Bar[];
  h1: Bar[];
  /** the last 1H candles the exchange reported closed (the derived day reads them) */
  h1Closed: Bar[];
  formingClose: number | null;
  base: LageBase | null;
  /** the daily gap the base was computed with (`null` without daily data) */
  gap: DailyGap | null;
  /**
   * Close time (Binance clock) of the earliest input bar the series already report as closed but `base` left out — its
   * close had not passed on `serverNow()` yet (a device clock a little behind Binance reads the socket's final frame
   * just before the close). `Infinity` = none. Once the clock passes it, the base is computed again.
   */
  pendingAt: number;
  view: LageView;
  viewKey: string;
}

const IDLE: LageFeedStatus = { state: "idle", fetchedAt: null, closedAt: null, nextAt: null, source: null, detail: null };
const listeners = new Set<() => void>();
const fresh = (): Ctl => ({
  refs: 0,
  provider: null,
  offHealth: null,
  liveTimer: null,
  lastLive: 0,
  offs: [],
  dKey: "",
  h4Key: "",
  h1Key: "",
  daily: [],
  h4: [],
  h1: [],
  h1Closed: [],
  formingClose: null,
  base: null,
  gap: null,
  pendingAt: Infinity,
  view: { lage: null, status: IDLE },
  viewKey: "",
});
const ctl: Ctl = fresh();

const hidden = (): boolean => typeof document !== "undefined" && document.hidden === true;
const offline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;
const serverNow = (): number => ctl.provider?.serverNow() ?? Date.now();
const toBar = (c: Candle): Bar => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume });

// ------------------------------------------------------------------ publish

function dailyHealth(): FeedHealth | undefined {
  return ctl.provider?.getHealth().feeds[DAILY_FEED];
}

function statusOf(): LageFeedStatus {
  const p = ctl.provider;
  if (!p) return IDLE;
  const fh = dailyHealth();
  const v = getFeed(DAILY_FEED);
  const last = ctl.daily.at(-1);
  const closedAt = last ? (last.t + 86_400) * 1000 : null;
  const fileNote = IS_FILE_BUILD || isFileProtocol();
  const failures = fh?.consecutiveFailures ?? 0;
  const why = failures > 0 && fh?.reason ? (FAIL_TEXT[fh.reason] ?? "Fehler") : null;
  const failing = why ? `${why}${failures > 1 ? ` · ${failures}× in Folge` : ""}` : null;
  const detail = failing && fileNote && (fh?.reason === "network" || fh?.reason === "cors") ? LAGE_FILE_CORS : failing;
  const sn = serverNow();
  const sinceClose = sn - Math.floor(sn / DAY_MS) * DAY_MS;
  const gap = ctl.daily.length ? ctl.gap : null;
  // the just-closed day read from its 1H candles (said after the usual grace) / missing for over an hour: no gate
  const note = gap?.expired ? LAGE_NO_CLOSE_TEXT : gap?.derived && sinceClose > MISSING_CLOSE_MS ? LAGE_DERIVED_TEXT : null;
  let state: LageFeedState;
  if (!ctl.daily.length) state = offline() ? "offline" : failures > 0 || fh?.reason === "unsupported" || fh?.reason === "bad_symbol" ? "error" : "loading";
  else if (offline()) state = "offline";
  else if (note) state = "stale";
  // the newest closed day ends before the last 00:00 UTC (+ grace): yesterday's close is missing
  else if (!gap?.derived && closedAt != null && closedAt < Math.floor(sn / DAY_MS) * DAY_MS && sinceClose > MISSING_CLOSE_MS) state = "stale";
  else state = failures > 0 || fh?.state === "stale" ? "stale" : "ok";
  return {
    state,
    fetchedAt: v ? v.receivedAt : null,
    closedAt,
    nextAt: fh?.nextRefreshAt ?? null,
    source: v?.source ?? null,
    detail: note && state === "stale" ? [note, detail].filter(Boolean).join(" · ") : (detail ?? (state === "stale" ? STALE_TEXT : null)),
  };
}

const statusKey = (s: LageFeedStatus): string => `${s.state}|${s.fetchedAt}|${s.closedAt}|${s.nextAt}|${s.source}|${s.detail}`;

function publish(lage: Lage | null): void {
  const status = statusOf();
  const key = `${lage ? lageKey(lage) : "∅"}#${statusKey(status)}`;
  if (key === ctl.viewKey) return;
  ctl.viewKey = key;
  ctl.view = { lage, status };
  for (const l of listeners) l();
}

function livePrice(): number | null {
  const p = priceMv.get();
  return Number.isFinite(p) && p > 0 ? p : ctl.formingClose;
}

/** Earliest close of a series bar the base left out although the series reports it closed (`Infinity` = none). */
function pendingCloseOf(b: LageBase | null): number {
  if (!b) return Infinity;
  let at = Infinity;
  const left = (bars: readonly Bar[], used: number, sec: number): void => {
    const x = bars[used];
    if (x) at = Math.min(at, (x.t + sec) * 1000);
  };
  left(ctl.daily, b.dailyN, 86_400);
  left(ctl.h4, b.h4N, 14_400);
  left(ctl.h1, b.h1N, 3_600);
  return at;
}

/** Live part (price → U1, distances); cheap. A closed bar the base is still waiting for recomputes the base first. */
function runLive(): void {
  if (serverNow() >= ctl.pendingAt) return runBase();
  liveOnly();
}

function liveOnly(): void {
  ctl.lastLive = Date.now();
  if (!ctl.base) return publish(null);
  publish(lageAt(ctl.base, livePrice(), serverNow()));
}

/** The daily gap at `sn` (Binance clock): is the just-closed day's 1D candle there, can its 1H candles stand in? */
function dailyGapOf(sn: number): DailyGap {
  const dayStart = Math.floor(sn / DAY_MS) * DAY_MS;
  const expected = dayStart - DAY_MS; // open of the day that closed at the last 00:00 UTC
  const last = ctl.daily.at(-1);
  const missing = !last || last.t * 1000 < expected;
  // only the just-closed day, right after the newest 1D candle (an older hole is not bridged)
  const derived = missing && last && last.t * 1000 === expected - DAY_MS ? dailyFromHourly(ctl.h1Closed, expected, sn) : null;
  const expired = missing && !derived && sn - dayStart > LAGE_NO_CLOSE_MS;
  const decideAt = missing && !derived && !expired ? dayStart + LAGE_NO_CLOSE_MS + 1 : dayStart + DAY_MS;
  return { missing, derived, expired, decideAt };
}

/**
 * Closed-bar part; only when an input bar changed, a closed bar it left out has closed on the Binance clock, or the
 * daily gap can change (00:00 UTC, 00:00 + 1 h). The just-closed day comes from its 1H candles while its 1D candle is
 * missing; missing for over an hour (and not derivable) → no Lage at all (no gate).
 */
function runBase(): void {
  const sn = serverNow();
  ctl.gap = ctl.provider && ctl.daily.length ? dailyGapOf(sn) : null;
  const daily = ctl.gap?.derived ? [...ctl.daily, ctl.gap.derived] : ctl.daily;
  ctl.base = ctl.provider && ctl.daily.length && !ctl.gap?.expired ? lageBase(daily, ctl.h4, sn, { h1: ctl.h1 }) : null;
  ctl.pendingAt = Math.min(pendingCloseOf(ctl.base), ctl.gap ? ctl.gap.decideAt : Infinity);
  liveOnly();
}

function onPrice(): void {
  if (ctl.liveTimer || hidden() || !ctl.base) return;
  const wait = Math.max(0, ctl.lastLive + LAGE_LIVE_MS - Date.now());
  ctl.liveTimer = setTimeout(() => {
    ctl.liveTimer = null;
    runLive();
  }, wait);
}

// ------------------------------------------------------------------ series

/**
 * Identity of the CLOSED part of a series (the forming candle is left out; a later candle closes the one before it)
 * — computed without copying, so a forming tick costs nothing.
 */
function closedKey(data: readonly Candle[]): { n: number; key: string } {
  const n = data.length > 0 && !data[data.length - 1]!.closed ? data.length - 1 : data.length;
  const lc = data[n - 1];
  return { n, key: lc ? `${n}:${lc.time}:${lc.close}:${data[0]!.time}` : "0" };
}

/** Re-reads the 1D / 4H / 1H series; true when a closed bar changed. */
function readSeries(): boolean {
  let changed = false;
  const dd = getFeed(DAILY_FEED)?.data ?? [];
  const kd = closedKey(dd);
  if (kd.key !== ctl.dKey) {
    ctl.dKey = kd.key;
    ctl.daily = dd.slice(Math.max(0, kd.n - LAGE_DAILY_LIMIT), kd.n).map(toBar);
    changed = true;
  }
  const d4 = getFeed("kline_4h")?.data ?? [];
  const last4 = d4[d4.length - 1];
  ctl.formingClose = last4 ? last4.close : null;
  const k4 = closedKey(d4);
  if (k4.key !== ctl.h4Key) {
    ctl.h4Key = k4.key;
    ctl.h4 = d4.slice(0, k4.n).map(toBar);
    changed = true;
  }
  const d1 = getFeed("kline_1h")?.data ?? [];
  const k1 = closedKey(d1);
  if (k1.key !== ctl.h1Key) {
    ctl.h1Key = k1.key;
    // the new-low chip reads the last 23 closed 1H bars
    ctl.h1 = d1.slice(Math.max(0, k1.n - 120), k1.n).map(toBar);
    // the derived day: the candles the exchange reported closed (a final socket frame or a REST page after the close)
    ctl.h1Closed = d1.slice(Math.max(0, k1.n - 48), k1.n).filter((c) => c.closed).map(toBar);
    changed = true;
  }
  return changed;
}

function onSeries(): void {
  syncProvider();
  if (readSeries() || serverNow() >= ctl.pendingAt) runBase();
  else publish(ctl.view.lage); // a status-only change (fetched again, next poll)
}

// ------------------------------------------------------------------ lifecycle

/** Follows the market provider (symbol / period switch). */
function syncProvider(): void {
  const p = getProvider();
  if (p === ctl.provider) return;
  ctl.offHealth?.();
  ctl.offHealth = null;
  ctl.provider = p;
  ctl.dKey = "";
  ctl.h4Key = "";
  ctl.h1Key = "";
  if (p && ctl.refs > 0) {
    // failures / next poll of the daily feed change the status line (published only when it changes)
    let last = "";
    ctl.offHealth = p.onHealth(() => {
      const fh = dailyHealth();
      const k = fh ? `${fh.state}|${fh.consecutiveFailures}|${fh.reason}|${fh.nextRefreshAt}|${fh.source}` : "";
      if (k === last) return;
      last = k;
      publish(ctl.view.lage);
    });
  }
  readSeries();
  runBase();
}

function onVisible(): void {
  if (hidden() || ctl.refs === 0) return;
  syncProvider();
  readSeries();
  runBase();
}

function start(): void {
  const onVis = (): void => onVisible();
  const onNet = (): void => publish(ctl.view.lage);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
  if (typeof window !== "undefined") {
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
  }
  ctl.offs = [
    subscribeFeed(DAILY_FEED, onSeries),
    subscribeFeed("kline_4h", onSeries),
    subscribeFeed("kline_1h", onSeries),
    priceMv.on("change", onPrice),
    () => {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onNet);
        window.removeEventListener("offline", onNet);
      }
    },
  ];
  ctl.provider = null;
  syncProvider();
}

function stop(): void {
  for (const off of ctl.offs) off();
  ctl.offs = [];
  ctl.offHealth?.();
  ctl.offHealth = null;
  if (ctl.liveTimer) clearTimeout(ctl.liveTimer);
  ctl.liveTimer = null;
}

/** Keeps the Lage running (ref-counted); returns an idempotent release. */
export function retainLage(): () => void {
  ctl.refs += 1;
  if (ctl.refs === 1) start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    ctl.refs -= 1;
    if (ctl.refs === 0) stop();
  };
}

/** Current Lage + feed status (stable object until a shown value changes). */
export function getLage(): LageView {
  return ctl.view;
}

/** Listener on published changes (≤ 1/s from the price, else on bar changes / status). */
export function subscribeLage(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

function subscribeRetained(cb: () => void): () => void {
  const off = subscribeLage(cb);
  const release = retainLage();
  return () => {
    off();
    release();
  };
}

const SERVER_VIEW: LageView = { lage: null, status: IDLE };

/**
 * React: the live Lage. Re-renders only when a shown value changes (state, signs, chips, distances at 0.1 %, levels,
 * feed status) — at most about once a second while the price moves, never per frame.
 */
export function useLage(): LageView {
  const provider = useProvider();
  const view = useSyncExternalStore(subscribeRetained, getLage, () => SERVER_VIEW);
  // a symbol / period switch replaces the provider: follow it at once (the feeds also report it)
  useEffect(() => {
    if (ctl.refs > 0) syncProvider();
  }, [provider]);
  return view;
}

/** Tests: forget everything (listeners registered by their owners stay). */
export function __resetLage(): void {
  stop();
  Object.assign(ctl, fresh());
  listeners.clear();
}
