/**
 * Archive collector (F26): in a fixed rhythm (5 / 10 / 15 minutes, only while the app is open and the switch is on) it
 * reads the public Binance USDⓈ-M numbers of the chosen symbols – mark price and the last settled funding rate
 * (`premiumIndex`), open interest, and the three long / short ratios – and the analysis states the app shows for the live
 * symbol, and writes them into the archive store. Nothing is estimated, nothing is back-filled: a point is written only
 * for what the exchange reported during the window this tick covers (the last interval, or since the previous tick when
 * the app ran without a pause), so the time the app was closed stays a visible gap. Every tick is logged with the reason
 * of each failure – that log is what explains a gap.
 *
 * Route: direct → the same-origin EU proxy (`/api/binance`) after a 451 / CORS / network / rate-limit answer, for the rest
 * of the session (never in the file build, which has no proxy). Own pacing (one request at a time, a pause between them),
 * a 429 / 418 backs the collector off for five minutes. No keys, no custom headers, nothing leaves the device.
 */
import { ARCHIVE_MAX_SYMBOLS, GAP_FACTOR, TICK_CAP, ringCap, type ArchiveCfg, type ArchivePoint, type Cell, type SeriesId, type TickRecord } from "@/domain/archive";
import { isFileProtocol, IS_FILE_BUILD } from "@/edition";
import type { BinanceRest, RatioKind } from "../sources/binance";
import { binanceRest } from "../sources/binance";
import { toRestError } from "../sources/http";
import { proxyRest } from "../sources/proxy";
import { ArchiveQuotaError, storageEstimate, type ArchiveDb } from "./db";

/** Pause between two requests. */
export const REQUEST_GAP_MS = 200;
/** After a rate-limit answer the collector leaves Binance alone for this long. */
export const RATE_BACKOFF_MS = 5 * 60_000;
/** The size limit / ring caps are applied after this many ticks (and at the start). */
export const TRIM_EVERY_TICKS = 30;
/** The browser's storage is considered full above this share of its quota. */
export const QUOTA_STOP_SHARE = 0.9;
/** The 5-minute ratio points are published a little after their time: look this far before the previous tick. */
const RATIO_LOOKBACK_MS = 5 * 60_000;
const RATIO_STEP_MS = 5 * 60_000;
const MAX_RATIO_LIMIT = 30;

/** One analysis state read from the app (the live symbol's Lage-Ampel or a box timeframe). */
export interface StateRead {
  series: SeriesId;
  symbol: string;
  d: Record<string, Cell>;
}

export interface CollectorDeps {
  db: ArchiveDb;
  rest: () => BinanceRest;
  proxy: () => BinanceRest | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  online: () => boolean;
  /** analysis states of the live symbol right now (empty when the analysis is not running) */
  readStates: () => StateRead[];
  estimate: () => Promise<{ usage: number; quota: number } | null>;
}

export const defaultDeps = (db: ArchiveDb): CollectorDeps => ({
  db,
  rest: () => binanceRest(),
  proxy: () => (IS_FILE_BUILD || isFileProtocol() ? null : proxyRest()),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  online: () => typeof navigator === "undefined" || (navigator as { onLine?: boolean }).onLine !== false,
  readStates: () => [],
  estimate: storageEstimate,
});

export interface TickResult {
  record: TickRecord;
  /** points written (raw + states) */
  written: number;
  /** why nothing could be written (quota), else `null` */
  paused: "quota" | null;
}

/** Failure kinds after which the same request is tried once through the proxy. */
const PROXY_FALLBACK = new Set(["blocked_451", "network", "cors", "rate_limited"]);

export class Collector {
  private viaProxy = false;
  private backoffUntil = 0;
  private last: TickRecord | null = null;
  private ticksSinceTrim = TRIM_EVERY_TICKS;

  constructor(private readonly deps: CollectorDeps) {}

  get route(): "direct" | "proxy" {
    return this.viaProxy ? "proxy" : "direct";
  }

  /** Device time of the newest tick of the log, `null` when there is none. */
  get lastTickAt(): number | null {
    return this.last?.t ?? null;
  }

  /** Reads the newest tick of the log (the window rule needs it after a reload). */
  async resume(): Promise<void> {
    const ticks = await this.deps.db.ticks();
    this.last = ticks.length ? ticks[ticks.length - 1]! : null;
  }

  private async call<T>(fn: (r: BinanceRest) => Promise<T>): Promise<T> {
    const proxy = this.deps.proxy();
    const first = this.viaProxy && proxy ? proxy : this.deps.rest();
    try {
      return await fn(first);
    } catch (e) {
      const err = toRestError(e);
      if (!this.viaProxy && proxy && PROXY_FALLBACK.has(err.kind)) {
        try {
          const v = await fn(proxy);
          this.viaProxy = true;
          return v;
        } catch (e2) {
          throw toRestError(e2);
        }
      }
      throw err;
    }
  }

  /** The five reads of one symbol → points; the first failure reason (or `null`) and how many calls failed. */
  private async readSymbol(symbol: string, windowStart: number, now: number): Promise<{ points: ArchivePoint[]; fails: string[]; calls: number }> {
    const points: ArchivePoint[] = [];
    const fails: string[] = [];
    const limit = Math.max(2, Math.min(MAX_RATIO_LIMIT, Math.ceil((now - windowStart) / RATIO_STEP_MS) + 1));
    const steps: Array<() => Promise<void>> = [
      async () => {
        const p = (await this.call((r) => r.premiumIndex(symbol))).data;
        points.push({ series: "premium", symbol, t: p.time, d: { mark: p.markPrice, index: p.indexPrice, rate: p.fundingRate, next: p.nextFundingTime } });
      },
      async () => {
        const o = (await this.call((r) => r.openInterest(symbol))).data;
        points.push({ series: "oi", symbol, t: o.time, d: { oi: o.openInterest } });
      },
      ...(["globalAccountRatio", "topPositionRatio", "topAccountRatio"] as RatioKind[]).map((kind) => async () => {
        const series: SeriesId = kind === "globalAccountRatio" ? "lsAcc" : kind === "topPositionRatio" ? "lsTopPos" : "lsTopAcc";
        const rows = (await this.call((r) => r.ratio(kind, symbol, "5m", { limit }))).data;
        // only what appeared inside this tick's window – older points are history the app did not watch
        for (const row of rows) if (row.time >= windowStart && row.time <= now + 60_000) points.push({ series, symbol, t: row.time, d: { long: row.longPct, short: row.shortPct, ratio: row.ratio } });
      }),
    ];
    let calls = 0;
    for (const step of steps) {
      if (calls > 0) await this.deps.sleep(REQUEST_GAP_MS);
      calls += 1;
      try {
        await step();
      } catch (e) {
        const kind = toRestError(e).kind as string;
        fails.push(kind);
        if (kind === "rate_limited") break;
      }
    }
    return { points, fails, calls: steps.length };
  }

  /** One tick for `symbols` (the caller has capped and validated them). Never throws. */
  async tick(cfg: ArchiveCfg, symbolsIn: readonly string[]): Promise<TickResult> {
    const now = this.deps.now();
    const symbols = symbolsIn.slice(0, ARCHIVE_MAX_SYMBOLS);
    const iv = cfg.everyMin;
    const prev = this.last;
    const continuous = prev !== null && now - prev.t <= GAP_FACTOR * prev.iv * 60_000;
    const windowStart = continuous ? prev.t - RATIO_LOOKBACK_MS : now - iv * 60_000;
    const res: Record<string, string> = {};
    const raw: ArchivePoint[] = [];

    if (!this.deps.online()) {
      for (const s of symbols) res[s] = "offline";
    } else if (now < this.backoffUntil) {
      for (const s of symbols) res[s] = "rate_limited";
    } else {
      let limited = false;
      for (let i = 0; i < symbols.length; i++) {
        const s = symbols[i]!;
        if (limited) {
          res[s] = "rate_limited";
          continue;
        }
        if (i > 0) await this.deps.sleep(REQUEST_GAP_MS);
        const r = await this.readSymbol(s, windowStart, now);
        raw.push(...r.points);
        const limitedHere = r.fails.includes("rate_limited");
        if (!r.fails.length) res[s] = "ok";
        else if (limitedHere) res[s] = "rate_limited";
        else if (r.fails.length >= r.calls) res[s] = r.fails[0]!;
        else res[s] = `partial:${r.fails[0]}`;
        if (limitedHere) {
          limited = true;
          this.backoffUntil = this.deps.now() + RATE_BACKOFF_MS;
        }
      }
    }

    const states = cfg.states ? this.deps.readStates() : [];
    const statePoints: ArchivePoint[] = states.map((s) => ({ series: s.series, symbol: s.symbol, t: now, d: s.d }));
    const record: TickRecord = { t: now, iv, route: this.route, res, states: statePoints.length > 0 };
    const all = [...raw, ...statePoints];

    let paused: TickResult["paused"] = null;
    try {
      const est = await this.deps.estimate();
      if (est && est.usage / est.quota > QUOTA_STOP_SHARE) paused = "quota";
      else await this.deps.db.putPoints(all);
    } catch (e) {
      if (e instanceof ArchiveQuotaError) paused = "quota";
      else throw e;
    }
    if (paused) {
      // the tick is still logged (small) so the gap says why
      for (const s of symbols) res[s] = "quota";
      record.states = false;
    }
    await this.deps.db.putTick(record).catch(() => undefined);
    this.last = record;

    this.ticksSinceTrim += 1;
    if (this.ticksSinceTrim >= TRIM_EVERY_TICKS) {
      this.ticksSinceTrim = 0;
      await this.trim(cfg.maxMb).catch(() => undefined);
    }
    return { record, written: paused ? 0 : all.length, paused };
  }

  /** Ring buffers: every row keeps its newest points under its own cap and the size limit. */
  async trim(maxMb: number): Promise<number> {
    const rows = await this.deps.db.overview();
    const keys = rows.length;
    const removed = await this.deps.db.trim((series) => ringCap(series, keys, maxMb));
    await this.deps.db.trimTicks(TICK_CAP);
    return removed;
  }
}
