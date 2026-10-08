/**
 * Live Lage-Ampel (decision 23): the daily kline feed + `useLage()` / `getLage()` / `subscribeLage()`.
 *
 * Inputs
 * - 1D: REST `/fapi/v1/klines?interval=1d` through `provider.fetchKlines` — the route, source and request budget of
 *   the kline feeds (Binance → proxy → Bybit as the provider runs them; a bulk call, never starves a live feed).
 *   First page `limit=1000` (weight 5, enough for the EMA 200), then only the missing days (`limit` 2–3, weight 1).
 *   Refreshed hourly and right after every daily close (00:00 UTC + 20 s on the Binance clock), at once on a resume
 *   (`visibilitychange` / `pageshow` / `online`) when the data is older than 5 min or a close passed; retries after
 *   30 s → 1 → 2 → 5 min; asleep while the tab is hidden. Only bars that had CLOSED when they were fetched are kept
 *   (a forming day fetched at 23:10 never reads as the 00:00 close).
 * - 4H / 1H: the provider's live `kline_4h` / `kline_1h` series (WS + REST bootstrap 499), closed candles only.
 * - Price: `priceMv` (freshest of trade / book / ticker), at most 1×/s; the forming 4H close stands in without it.
 *
 * Cadence (120 Hz rule): EMAs + structure (`lageBase`, ≈ 0.5 ms) run only when a closed input bar changes; a price
 * move recomputes the live part (≈ 0.04 ms) at most once a second and publishes a new snapshot only when a shown value
 * changes (`lageKey`: state, signs, chips, distances at 0.1 %). Nothing runs per frame, nothing while hidden.
 * Retained by subscribers (`useLage`, `retainLage`); with none the timers and listeners are off, the bars stay cached.
 */
import { useEffect, useSyncExternalStore } from "react";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { DAY_MS, lageAt, lageBase, lageKey, nextDailyClose, type Lage, type LageBase } from "@/domain/lage";
import type { Bar } from "@/domain/signals/indicators";
import { getFeed, getProvider, subscribeFeed, useProvider } from "./marketStore";
import { priceMv } from "./motionValues";
import type { MarketProvider } from "./provider";
import { RestError } from "./sources/http";
import { SOFT_FAILURE_TEXT } from "./statusLabel";
import type { Candle, Source } from "./types";

/** First daily page (Binance weight 5): EMA 200 settles, the structure sees 500 days. */
export const LAGE_DAILY_LIMIT = 1000;
/** Regular refresh of the daily series. */
export const LAGE_REFRESH_MS = 60 * 60_000;
/** After 00:00 UTC (Binance clock) the closed day is fetched this much later. */
export const LAGE_CLOSE_GRACE_MS = 20_000;
/** A resume refetches when the data is older than this (or a daily close passed). */
export const LAGE_RESUME_MS = 5 * 60_000;
/** Live price → distances at most this often. */
export const LAGE_LIVE_MS = 1000;
const RETRY_MS = [30_000, 60_000, 120_000, 300_000] as const;
const MAX_WAIT_MS = 30_000;

export type LageFeedState = "idle" | "loading" | "ok" | "stale" | "error" | "offline";

export interface LageFeedStatus {
  state: LageFeedState;
  /** device time of the last successful daily fetch */
  fetchedAt: number | null;
  /** close time of the newest closed daily bar (ms, exchange time) */
  closedAt: number | null;
  /** next planned fetch (device time) */
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

interface Ctl {
  refs: number;
  provider: MarketProvider | null;
  symbol: string;
  daily: Bar[];
  fetchedAt: number | null;
  source: Source | null;
  failures: number;
  failKind: string | null;
  inflight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  nextAt: number | null;
  liveTimer: ReturnType<typeof setTimeout> | null;
  lastLive: number;
  offs: Array<() => void>;
  h4Key: string;
  h1Key: string;
  h4: Bar[];
  h1: Bar[];
  formingClose: number | null;
  base: LageBase | null;
  view: LageView;
  viewKey: string;
}

const IDLE: LageFeedStatus = { state: "idle", fetchedAt: null, closedAt: null, nextAt: null, source: null, detail: null };
const listeners = new Set<() => void>();
const ctl: Ctl = {
  refs: 0,
  provider: null,
  symbol: "",
  daily: [],
  fetchedAt: null,
  source: null,
  failures: 0,
  failKind: null,
  inflight: false,
  timer: null,
  nextAt: null,
  liveTimer: null,
  lastLive: 0,
  offs: [],
  h4Key: "",
  h1Key: "",
  h4: [],
  h1: [],
  formingClose: null,
  base: null,
  view: { lage: null, status: IDLE },
  viewKey: "",
};

const hidden = (): boolean => typeof document !== "undefined" && document.hidden === true;
const offline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;
const serverNow = (): number => ctl.provider?.serverNow() ?? Date.now();
const toBar = (c: Candle): Bar => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume });

// ------------------------------------------------------------------ publish

function statusOf(): LageFeedStatus {
  const now = serverNow();
  const last = ctl.daily.at(-1);
  const closedAt = last ? (last.t + 86_400) * 1000 : null;
  const fileNote = IS_FILE_BUILD || isFileProtocol();
  const why = ctl.failKind ? (FAIL_TEXT[ctl.failKind] ?? "Fehler") : null;
  const failing = ctl.failures > 0 && why ? `${why}${ctl.failures > 1 ? ` · ${ctl.failures}× in Folge` : ""}` : null;
  const detail = failing && fileNote && (ctl.failKind === "network" || ctl.failKind === "cors") ? LAGE_FILE_CORS : failing;
  let state: LageFeedState;
  if (!ctl.provider) state = "idle";
  else if (!ctl.daily.length) state = offline() ? "offline" : ctl.failures > 0 ? "error" : "loading";
  else if (offline()) state = "offline";
  // the newest close is a full day plus the grace behind the Binance clock: yesterday's close is missing
  else if (closedAt != null && now - closedAt > DAY_MS + LAGE_CLOSE_GRACE_MS + 5 * 60_000) state = "stale";
  else state = ctl.failures > 0 ? "stale" : "ok";
  return {
    state,
    fetchedAt: ctl.fetchedAt,
    closedAt,
    nextAt: ctl.nextAt,
    source: ctl.source,
    detail: detail ?? (state === "stale" && !failing ? STALE_TEXT : null),
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

/** Live part (price → U1, distances); cheap. */
function runLive(): void {
  ctl.lastLive = Date.now();
  if (!ctl.base) return publish(null);
  publish(lageAt(ctl.base, livePrice(), serverNow()));
}

/** Closed-bar part; only when an input bar changed. */
function runBase(): void {
  if (!ctl.provider || !ctl.daily.length) {
    ctl.base = null;
    return publish(null);
  }
  ctl.base = lageBase(ctl.daily, ctl.h4, serverNow(), { h1: ctl.h1 });
  runLive();
}

function onPrice(): void {
  if (ctl.liveTimer || hidden() || !ctl.base) return;
  const wait = Math.max(0, ctl.lastLive + LAGE_LIVE_MS - Date.now());
  ctl.liveTimer = setTimeout(() => {
    ctl.liveTimer = null;
    runLive();
  }, wait);
}

// ------------------------------------------------------------------ 4H / 1H from the live feeds

/**
 * Identity of the CLOSED part of a live series (the forming candle is left out; a later candle closes the one
 * before it) — computed without copying, so a forming tick costs nothing.
 */
function closedKey(data: readonly Candle[]): { n: number; key: string } {
  const n = data.length > 0 && !data[data.length - 1]!.closed ? data.length - 1 : data.length;
  const lc = data[n - 1];
  return { n, key: lc ? `${n}:${lc.time}:${lc.close}:${data[0]!.time}` : "0" };
}

/** Re-reads the 4H / 1H series; true when a closed bar changed. */
function readSeries(): boolean {
  let changed = false;
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
    changed = true;
  }
  return changed;
}

function onSeries(): void {
  syncProvider();
  if (readSeries()) runBase();
}

// ------------------------------------------------------------------ 1D REST series

/** Upsert by open time, keep the newest `LAGE_DAILY_LIMIT`. */
function mergeDaily(prev: readonly Bar[], next: readonly Bar[]): Bar[] {
  if (!prev.length) return next.slice(-LAGE_DAILY_LIMIT);
  const first = next[0];
  if (!first) return prev.slice();
  const keep = prev.filter((b) => b.t < first.t);
  const out = [...keep, ...next];
  return out.length > LAGE_DAILY_LIMIT ? out.slice(out.length - LAGE_DAILY_LIMIT) : out;
}

function arm(at: number): void {
  if (ctl.timer) clearTimeout(ctl.timer);
  ctl.nextAt = at;
  ctl.timer = setTimeout(
    () => {
      ctl.timer = null;
      fetchDaily();
    },
    Math.max(0, at - Date.now()),
  );
}

/** Next regular fetch (device time): in an hour, or right after the next daily close if that comes first. */
function nextRegular(): number {
  const skew = serverNow() - Date.now();
  const close = nextDailyClose(serverNow()) - skew + LAGE_CLOSE_GRACE_MS;
  return Math.min(Date.now() + LAGE_REFRESH_MS, close);
}

function fetchDaily(): void {
  const p = ctl.provider;
  if (!p || ctl.inflight || ctl.refs === 0) return;
  if (hidden() && ctl.daily.length) {
    // asleep while hidden: the resume handler fetches when the tab comes back
    ctl.nextAt = null;
    return;
  }
  const last = ctl.daily.at(-1);
  // from the newest kept day (re-read, harmless) to the forming one
  const missing = last ? Math.ceil((serverNow() - last.t * 1000) / DAY_MS) : LAGE_DAILY_LIMIT;
  const limit = ctl.daily.length < 60 ? LAGE_DAILY_LIMIT : Math.min(LAGE_DAILY_LIMIT, Math.max(2, missing));
  ctl.inflight = true;
  if (!ctl.daily.length) publish(ctl.view.lage);
  p.fetchKlines("1d", { limit, maxWaitMs: MAX_WAIT_MS })
    .then((v) => {
      if (ctl.provider !== p) return;
      const at = serverNow();
      // only days that had closed when Binance answered (the forming day is fetched again after 00:00)
      const closed = v.data.filter((c) => c.time + DAY_MS <= at).map(toBar);
      ctl.daily = limit >= LAGE_DAILY_LIMIT && closed.length >= ctl.daily.length ? closed.slice(-LAGE_DAILY_LIMIT) : mergeDaily(ctl.daily, closed);
      ctl.fetchedAt = Date.now();
      ctl.source = v.source;
      ctl.failures = 0;
      ctl.failKind = null;
      ctl.inflight = false;
      arm(nextRegular());
      runBase();
    })
    .catch((err: unknown) => {
      if (ctl.provider !== p) return;
      ctl.inflight = false;
      ctl.failures += 1;
      ctl.failKind = err instanceof RestError ? err.kind : "network";
      const wait = RETRY_MS[Math.min(RETRY_MS.length - 1, ctl.failures - 1)]!;
      arm(Math.min(Date.now() + wait, nextRegular()));
      publish(ctl.view.lage);
    });
}

/** Tab back / online: fetch when the data is old or a daily close passed since the last fetch; recompute. */
function onResume(): void {
  if (ctl.refs === 0 || hidden()) return;
  syncProvider();
  const last = ctl.fetchedAt;
  const closePassed = last != null && nextDailyClose(last + (serverNow() - Date.now())) <= serverNow();
  if (!ctl.inflight && (last == null || Date.now() - last > LAGE_RESUME_MS || closePassed || ctl.failures > 0)) {
    if (ctl.timer) clearTimeout(ctl.timer);
    ctl.timer = null;
    fetchDaily();
  } else if (!ctl.timer && !ctl.inflight) arm(nextRegular());
  readSeries();
  runBase();
}

// ------------------------------------------------------------------ lifecycle

/** Follows the market provider (symbol change: other bars; period change: same symbol, data kept). */
function syncProvider(): void {
  const p = getProvider();
  if (p === ctl.provider) return;
  ctl.provider = p;
  // a stopped market (no provider) keeps the bars: a period switch (stop → start, same symbol) needs no new page
  if (p && p.symbol !== ctl.symbol) {
    ctl.symbol = p.symbol;
    ctl.daily = [];
    ctl.fetchedAt = null;
    ctl.source = null;
    ctl.base = null;
  }
  ctl.failures = 0;
  ctl.failKind = null;
  ctl.inflight = false;
  ctl.h4Key = "";
  ctl.h1Key = "";
  if (ctl.timer) clearTimeout(ctl.timer);
  ctl.timer = null;
  ctl.nextAt = null;
  if (p && ctl.refs > 0) {
    readSeries();
    if (!ctl.daily.length || ctl.fetchedAt == null || Date.now() - ctl.fetchedAt > LAGE_RESUME_MS) fetchDaily();
    else arm(nextRegular());
  }
  runBase();
}

function start(): void {
  const onVis = (): void => {
    if (!hidden()) onResume();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
  if (typeof window !== "undefined") {
    window.addEventListener("online", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("offline", onOffline);
  }
  ctl.offs = [
    subscribeFeed("kline_4h", onSeries),
    subscribeFeed("kline_1h", onSeries),
    priceMv.on("change", onPrice),
    () => {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onResume);
        window.removeEventListener("pageshow", onResume);
        window.removeEventListener("offline", onOffline);
      }
    },
  ];
  ctl.provider = null;
  syncProvider();
}

function onOffline(): void {
  publish(ctl.view.lage);
}

function stop(): void {
  for (const off of ctl.offs) off();
  ctl.offs = [];
  if (ctl.timer) clearTimeout(ctl.timer);
  if (ctl.liveTimer) clearTimeout(ctl.liveTimer);
  ctl.timer = null;
  ctl.liveTimer = null;
  ctl.nextAt = null;
  ctl.inflight = false;
}

/** Keeps the Lage feed running (ref-counted); returns an idempotent release. */
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

/** Tests: forget everything (timers, bars, listeners stay registered by their owners). */
export function __resetLage(): void {
  stop();
  Object.assign(ctl, {
    refs: 0,
    provider: null,
    symbol: "",
    daily: [],
    fetchedAt: null,
    source: null,
    failures: 0,
    failKind: null,
    inflight: false,
    lastLive: 0,
    h4Key: "",
    h1Key: "",
    h4: [],
    h1: [],
    formingClose: null,
    base: null,
    view: { lage: null, status: IDLE },
    viewKey: "",
  });
  listeners.clear();
}
