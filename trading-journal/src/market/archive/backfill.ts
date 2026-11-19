/**
 * „Börsenhistorie nachladen“ (F26/F07) – the run. One explicit action: for the chosen symbols it reads Binance's public
 * history (funding settlements, 5-minute mark price, 5-minute open interest and the three long / short ratios; the exchange
 * keeps the last ~30 days of the ratios) window by window and stores it as the `…Hist` series – beside what the collector
 * wrote, never in it. Nothing is estimated, smoothed or filled: a window the exchange did not answer is a gap and the
 * result says why. Progress is reported after every request, the run can be cancelled between (and during) requests, and
 * what was stored before stays stored – labelled „nachgeladen“ like everything of this run.
 *
 * Route: direct → the same-origin EU proxy after a 451 / CORS / network answer (`RestRoute`, the collector's rule). Own pacing
 * (one request at a time, a pause between), a rate-limit answer ends the run (the exchange is left alone). No keys, no custom
 * headers, nothing leaves the device but the public GET requests.
 */
import {
  BACKFILL_MAX_SYMBOLS,
  BACKFILL_SERIES_ORDER,
  FUNDING_LIMIT,
  KLINE_STEPS_PER_REQUEST,
  RATIO_STEPS_PER_REQUEST,
  backfillRange,
  fundingHistPoints,
  markHistPoints,
  oiHistPoints,
  planBackfill,
  ratioHistPoints,
  seriesResult,
  windowsOf,
  type ArchivePoint,
  type BackfillEnd,
  type BackfillRun,
  type BackfillSeries,
  type SeriesResult,
  type Window,
} from "@/domain/archive";
import { isFileProtocol, IS_FILE_BUILD } from "@/edition";
import { binanceRest, type BinanceRest, type RatioKind } from "../sources/binance";
import { toRestError } from "../sources/http";
import { proxyRest } from "../sources/proxy";
import { RestRoute, abortableFetch } from "../sources/route";
import { QUOTA_STOP_SHARE } from "./collector";
import { ArchiveQuotaError, storageEstimate, type ArchiveDb } from "./db";

/** Pause between two requests: ~2 requests a second stays far under the exchange's 1000 per 5 minutes for the history endpoints. */
export const BACKFILL_GAP_MS = 350;

export interface BackfillDeps {
  db: ArchiveDb;
  rest: () => BinanceRest;
  proxy: () => BinanceRest | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  online: () => boolean;
  estimate: () => Promise<{ usage: number; quota: number } | null>;
}

export const defaultBackfillDeps = (db: ArchiveDb, signal?: AbortSignal): BackfillDeps => ({
  db,
  rest: () => binanceRest({ fetch: abortableFetch(signal) }),
  proxy: () => (IS_FILE_BUILD || isFileProtocol() ? null : proxyRest({ fetch: abortableFetch(signal) })),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  online: () => typeof navigator === "undefined" || (navigator as { onLine?: boolean }).onLine !== false,
  estimate: storageEstimate,
});

export interface BackfillProgress {
  state: "running" | BackfillEnd;
  requestsDone: number;
  requestsTotal: number;
  /** what is being read right now */
  symbol: string | null;
  series: BackfillSeries | null;
  /** points stored so far */
  points: number;
  route: "direct" | "proxy";
  /** per symbol, per dataset: the result so far */
  res: Readonly<Record<string, Readonly<Record<string, SeriesResult>>>>;
  /** why the run stopped early (a short German sentence), `null` otherwise */
  stopped: string | null;
}

export interface BackfillOptions {
  symbols: readonly string[];
  days: number;
  signal?: AbortSignal;
  onProgress?: (p: BackfillProgress) => void;
}

const RATIO_KIND: Readonly<Record<"lsAccHist" | "lsTopPosHist" | "lsTopAccHist", RatioKind>> = {
  lsAccHist: "globalAccountRatio",
  lsTopPosHist: "topPositionRatio",
  lsTopAccHist: "topAccountRatio",
};

/** After this many failed windows in a row the rest of that dataset is skipped (the next would fail the same way). */
const MAX_FAILS_IN_A_ROW = 2;
/** Failures that mean „Binance is not reachable from here at all“; this many datasets in a row end the run. */
const UNREACHABLE = new Set(["blocked_451", "network", "cors", "offline"]);
const MAX_UNREACHABLE_SERIES = 3;

async function readWindow(net: RestRoute, series: BackfillSeries, symbol: string, w: Window): Promise<ArchivePoint[]> {
  switch (series) {
    case "fundingHist": {
      const rows = (await net.call((r) => r.fundingRate(symbol, { limit: FUNDING_LIMIT, startTime: w.from, endTime: w.to }))).data;
      return fundingHistPoints(symbol, rows, w);
    }
    case "markHist": {
      const rows = (await net.call((r) => r.markPriceKlines(symbol, "5m", { limit: KLINE_STEPS_PER_REQUEST + 60, startTime: w.from, endTime: w.to }))).data;
      return markHistPoints(symbol, rows.map((c) => ({ time: c.time, close: c.close, closed: c.closed })), w);
    }
    case "oiHist": {
      const rows = (await net.call((r) => r.openInterestHist(symbol, "5m", { limit: RATIO_STEPS_PER_REQUEST + 20, startTime: w.from, endTime: w.to }))).data;
      return oiHistPoints(symbol, rows, w);
    }
    default: {
      const rows = (await net.call((r) => r.ratio(RATIO_KIND[series], symbol, "5m", { limit: RATIO_STEPS_PER_REQUEST + 20, startTime: w.from, endTime: w.to }))).data;
      return ratioHistPoints(series, symbol, rows, w);
    }
  }
}

/** Copies the nested result so the view never sees it change under its feet. */
const copyRes = (res: Record<string, Record<string, SeriesResult>>): Record<string, Record<string, SeriesResult>> => Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { ...v }]));

/** Runs one load. Never throws: the result says what happened. */
export async function runBackfill(deps: BackfillDeps, opts: BackfillOptions): Promise<BackfillRun> {
  const now = deps.now();
  const plan = planBackfill(opts.symbols.slice(0, BACKFILL_MAX_SYMBOLS), opts.days, now);
  const { from, to } = backfillRange(opts.days, now);
  const net = new RestRoute(deps.rest, deps.proxy);
  const res: Record<string, Record<string, SeriesResult>> = {};
  let done = 0;
  let points = 0;
  let end: BackfillEnd = "done";
  let stopped: string | null = null;
  let unreachableSeries = 0;
  const cancelled = (): boolean => opts.signal?.aborted === true;

  const report = (state: BackfillProgress["state"], symbol: string | null, series: BackfillSeries | null): void =>
    opts.onProgress?.({ state, requestsDone: done, requestsTotal: plan.requests, symbol, series, points, route: net.route, res: copyRes(res), stopped });

  report("running", null, null);
  if (!plan.symbols.length) {
    end = "failed";
    stopped = "Kein Symbol gewählt.";
  }

  outer: for (const symbol of plan.symbols) {
    const per: Record<string, SeriesResult> = (res[symbol] = {});
    for (const series of BACKFILL_SERIES_ORDER) {
      const windows = windowsOf(series, from, to);
      const failed: string[] = [];
      let inARow = 0;
      let fetched = 0;
      /** a stop inside this dataset: what it holds so far is kept and said */
      const stop = (e: BackfillEnd, why: string): void => {
        end = e;
        stopped = why;
        per[series] = e === "cancelled" && fetched > 0 ? "partial:cancelled" : seriesResult(windows.length, fetched, failed);
      };
      for (let i = 0; i < windows.length; i++) {
        if (done > 0) await deps.sleep(BACKFILL_GAP_MS);
        if (cancelled()) {
          stop("cancelled", "Abgebrochen.");
          break outer;
        }
        if (!deps.online()) {
          failed.push("offline");
          stop("failed", "Das Gerät ist offline.");
          break outer;
        }
        report("running", symbol, series);
        try {
          const est = await deps.estimate();
          if (est && est.usage / est.quota > QUOTA_STOP_SHARE) throw new ArchiveQuotaError();
          const pts = await readWindow(net, series, symbol, windows[i]!);
          await deps.db.putPoints(pts);
          points += pts.length;
          fetched += 1;
          inARow = 0;
          done += 1;
          report("running", symbol, series);
        } catch (e) {
          if (cancelled()) {
            stop("cancelled", "Abgebrochen.");
            break outer;
          }
          done += 1;
          if (e instanceof ArchiveQuotaError) {
            failed.push("quota");
            stop("failed", "Der Browser-Speicher ist fast voll – das Nachladen hält an.");
            break outer;
          }
          const kind = toRestError(e).kind as string;
          failed.push(kind);
          inARow += 1;
          if (kind === "rate_limited") {
            stop("failed", "Binance bremst (429/418/403) – das Nachladen hält an, um die Börse in Ruhe zu lassen. Versuche es später noch einmal.");
            break outer;
          }
          if (inARow >= MAX_FAILS_IN_A_ROW) {
            done += windows.length - 1 - i; // the rest of this dataset is skipped, not asked
            break;
          }
        }
      }
      per[series] = seriesResult(windows.length, fetched, failed);
      if (fetched === 0 && failed.length > 0 && UNREACHABLE.has(failed[0]!)) {
        unreachableSeries += 1;
        if (unreachableSeries >= MAX_UNREACHABLE_SERIES) {
          end = "failed";
          stopped = "Binance ist von hier aus nicht erreichbar – das Nachladen hält an.";
          break outer;
        }
      } else if (fetched > 0) unreachableSeries = 0;
    }
  }

  // what a stopped run did not reach is „skipped“ – never silently missing
  for (const symbol of plan.symbols) {
    const per = (res[symbol] ??= {});
    for (const s of BACKFILL_SERIES_ORDER) per[s] ??= "skipped";
  }
  const run: BackfillRun = { t: deps.now(), end, days: opts.days, from, to, route: net.route, symbols: plan.symbols, points, res };
  report(end, null, null);
  return run;
}
