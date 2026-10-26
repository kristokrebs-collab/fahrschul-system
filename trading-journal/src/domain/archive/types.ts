/**
 * Historisches Datenarchiv (F26) – the shapes. Pure: no React, no I/O.
 *
 * What the archive holds is what the app SAW while it was open: raw public numbers of Binance USDⓈ-M futures (funding
 * rate, open interest, long / short ratios) and the analysis states the app showed at that moment (Lage-Ampel, box
 * phases). Nothing is estimated and no gap is ever filled – a stretch with no point is a gap, and the tick log says
 * whether the app was closed or the request failed.
 */

/** Series ids. `raw` = a public number of the exchange, `state` = what the app's own analysis said at that moment. */
export type SeriesId = "premium" | "oi" | "lsAcc" | "lsTopPos" | "lsTopAcc" | "lage" | "box4h" | "box1d" | "box1w";
export type SeriesKind = "raw" | "state";

/** A cell of a point: a number, a word (state / phase) or "no value". Never an estimate. */
export type Cell = number | string | null;

/** One archived point. `t` = epoch ms of the exchange (raw) or of the tick (state). */
export interface ArchivePoint {
  series: SeriesId;
  symbol: string;
  t: number;
  d: Readonly<Record<string, Cell>>;
}

/**
 * One collector tick (the log that explains gaps). `res` per symbol: `ok`, `partial:<reason>` (some requests failed) or
 * the reason of a total failure (`blocked_451`, `network`, `rate_limited`, `timeout`, `offline`, `http_5xx`,
 * `bad_symbol`, `budget`).
 */
export interface TickRecord {
  /** device time the tick ran (ms) */
  t: number;
  /** the interval in force (minutes) – the gap threshold of that stretch */
  iv: number;
  route: "direct" | "proxy";
  res: Readonly<Record<string, string>>;
  /** analysis states were written in this tick */
  states: boolean;
}

/** What `overview()` of the store says about one series of one symbol. */
export interface SeriesInfo {
  series: SeriesId;
  symbol: string;
  count: number;
  first: number;
  last: number;
}

/** Device-local archive settings (`tj2-archive-cfg`). Never part of the journal's settings: not in backup, not in cloud sync. */
export interface ArchiveCfg {
  v: 1;
  /** the switch – off until the user turns it on */
  on: boolean;
  /** minutes between two ticks */
  everyMin: 5 | 10 | 15;
  /** explicit symbols (≤ `ARCHIVE_MAX_SYMBOLS`); `null` = automatic: the live symbol plus the first of the watchlist */
  picked: string[] | null;
  /** also write the analysis states (Lage-Ampel, box phases of the live symbol) */
  states: boolean;
  /** upper bound of the (estimated) archive size in MB; the oldest points go first */
  maxMb: 10 | 25 | 50 | 100;
}

/** Why a stretch without points exists. */
export type GapCause =
  /** no tick at all: the app (or the tab) was closed, asleep or frozen */
  | "app"
  /** ticks ran but the requests failed (reason in `detail`) */
  | "failed"
  /** ticks ran without this symbol (not selected at that time) */
  | "unwatched"
  /** ticks ran and the symbol was fine, but the analysis was not available (state series only) */
  | "analysis"
  /** ticks ran and none failed, yet the points are missing – said as unknown, never guessed */
  | "unknown";

export interface Gap {
  /** last point before / first point after (ms) */
  from: number;
  to: number;
  cause: GapCause;
  /** the most frequent failure reason of the ticks inside (only for `failed`) */
  detail: string | null;
  /** ticks that ran inside the gap */
  ticks: number;
}
