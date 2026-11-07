/**
 * The three alert sources as `AlertSource`s (server side): each reads ONE kind of data and returns plain readings; the pure part (what a
 * reading means) is in `src/domain/alerts/sources/`. The data comes in through small function parameters (`RunLoaders`), so a run is
 * tested with fakes and no network. A source that cannot read returns no reading – nothing is guessed, nothing is reset.
 */
import { industryReadings } from "../../../../src/domain/alerts/sources/industry";
import { whaleReading, type RatioPoint } from "../../../../src/domain/alerts/sources/whale";
import type { AlertReadContext, AlertReading, AlertSource } from "../../../../src/domain/alerts/types";
import type { IndustryDataset } from "../../../../src/domain/industryTrend/ampel";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** What a run can load. `null` / `[]` = not available right now (the source then gives no reading). */
export interface RunLoaders {
  /** the 48-industry dataset (loaded once per run, cached by the loader) */
  industry(): Promise<IndustryDataset | null>;
  /** the top-trader position series of one symbol, ascending, or `null` */
  ratio(symbol: string): Promise<RatioPoint[] | null>;
  /** the readings of the account's own key levels (`settings.keyLevels` as stored) */
  keyLevels(userId: string, raw: unknown, now: number): Promise<AlertReading[]>;
}

/** Branchen-Trend: the file changes about once a month – a look every 6 hours is plenty; a reading is stale after 120 days. */
export function industrySource(load: RunLoaders["industry"]): AlertSource {
  return {
    kind: "industry",
    everyMs: 6 * HOUR,
    maxAgeMs: 120 * DAY,
    async read(ctx: AlertReadContext) {
      const data = await load();
      return data ? industryReadings(data, ctx.markets) : [];
    },
  };
}

/** Top-Trader-Umschlag: Binance publishes a point every 5 minutes; older than 15 minutes is stale. */
export function whaleSource(ratio: RunLoaders["ratio"]): AlertSource {
  return {
    kind: "whale",
    everyMs: 5 * MIN,
    maxAgeMs: 15 * MIN,
    async read(ctx: AlertReadContext) {
      const out: AlertReading[] = [];
      for (const symbol of ctx.markets) {
        const series = await ratio(symbol);
        const r = series ? whaleReading(symbol, series, ctx.params.confirm) : null;
        if (r) out.push(r);
      }
      return out;
    },
  };
}

/** Schlüsselmarken: the account's own levels, evaluated on their candles; a reading from this run is fresh by definition. */
export function keylevelSource(keyLevels: RunLoaders["keyLevels"], levelsOf: (userId: string) => Promise<unknown>): AlertSource {
  return {
    kind: "keylevel",
    everyMs: 5 * MIN,
    maxAgeMs: 15 * MIN,
    async read(ctx: AlertReadContext) {
      return keyLevels(ctx.userId, await levelsOf(ctx.userId), ctx.now);
    },
  };
}
