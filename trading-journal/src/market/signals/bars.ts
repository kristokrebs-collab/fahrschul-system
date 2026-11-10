/**
 * Candle → signal-engine bar adapter and the timeframe source table: which exchange series feeds which ladder
 * rung, and how many source bars a rung needs.
 *
 * | rung | source | factor |
 * |------|--------|--------|
 * | 30m, 45m | `kline_15m` (WS + REST) | 2, 3 (exact, UTC-session aligned — see `resampleBars`) |
 * | 1h, 2h, 3h | `kline_1h` | 1, 2, 3 |
 * | 4h | `kline_4h` | 1 |
 * | 1D | `kline_1d` (the provider's REST daily feed: hourly, cached; the Lage-Ampel reads it too) | 1 |
 */
import { SIGNAL_BARS, resampleBars, tfSeconds, type Bar } from "@/domain/signals";
import type { FetchInterval } from "../period";
import type { Candle, KlineFeed } from "../types";

export interface TfSource {
  /** exchange interval the rung is built from */
  interval: FetchInterval;
  /** live feed for that interval (`kline_1d`: the provider's REST daily feed) */
  feed: KlineFeed;
  /** source bar length, seconds */
  srcSec: number;
  /** source bars per rung bar */
  factor: number;
}

const SRC: Record<string, Omit<TfSource, "factor">> = {
  "15m": { interval: "15m", feed: "kline_15m", srcSec: 900 },
  "30m": { interval: "15m", feed: "kline_15m", srcSec: 900 },
  "45m": { interval: "15m", feed: "kline_15m", srcSec: 900 },
  "1h": { interval: "1h", feed: "kline_1h", srcSec: 3600 },
  "2h": { interval: "1h", feed: "kline_1h", srcSec: 3600 },
  "3h": { interval: "1h", feed: "kline_1h", srcSec: 3600 },
  "4h": { interval: "4h", feed: "kline_4h", srcSec: 14_400 },
  "1D": { interval: "1d", feed: "kline_1d", srcSec: 86_400 },
};

/** Source of a ladder / zone timeframe, `null` for a timeframe the engine cannot build. */
export function tfSource(tf: string): TfSource | null {
  const s = SRC[tf];
  const sec = tfSeconds(tf);
  if (!s || !sec || sec % s.srcSec !== 0) return null;
  return { ...s, factor: sec / s.srcSec };
}

/** Timeframes a config evaluates (ladder + zone timeframe), unique. */
export function neededTfs(cfg: { ladder: readonly string[]; zoneTf: string }): string[] {
  return [...new Set([...cfg.ladder, cfg.zoneTf])];
}

export const candleToBar = (c: Candle): Bar => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume });

/** How far back a same-prefix update looks for replaced candles before converting the whole series again. */
const TAIL_SCAN = 64;

/**
 * Memoised candle → bar conversion of a live series. The feeds replace their array on every tick but keep the
 * prefix: when the new array has the same start and length (forming bar updated) or one more bar (a new bar), only
 * the tail is converted. The tail is found by object identity, not by time: `upsertBar` keeps the prefix objects and
 * `upsertSeries` puts its incoming objects into the overlap, so a REST gap fill that corrects an older bar after the
 * socket already appended the next one (a reconnect across a candle boundary) is converted too.
 */
export class BarConverter {
  private src: readonly Candle[] | null = null;
  private bars: Bar[] = [];

  convert(candles: readonly Candle[]): Bar[] {
    if (candles === this.src) return this.bars;
    const prev = this.src;
    const n = candles.length;
    let out: Bar[];
    if (prev && prev.length > 1 && n >= prev.length && n <= prev.length + 1 && candles[0]?.time === prev[0]?.time && candles[prev.length - 2]?.time === prev[prev.length - 2]?.time) {
      // same prefix: re-convert the old last bar (it may have closed), every replaced candle before it and anything
      // appended
      let from = prev.length - 1;
      const floor = Math.max(0, from - TAIL_SCAN);
      while (from > floor && candles[from - 1] !== prev[from - 1]) from--;
      if (from === floor && floor > 0 && candles[floor - 1] !== prev[floor - 1]) out = candles.map(candleToBar);
      else {
        out = this.bars.slice(0, from);
        for (let i = from; i < n; i++) out.push(candleToBar(candles[i]!));
      }
    } else {
      out = candles.map(candleToBar);
    }
    this.src = candles;
    this.bars = out;
    return out;
  }

  reset(): void {
    this.src = null;
    this.bars = [];
  }
}

/** Rung bars from source bars: the tail that yields `SIGNAL_BARS` rung bars, resampled. */
export function rungBars(tf: string, source: readonly Bar[], bars: number = SIGNAL_BARS): Bar[] {
  const s = tfSource(tf);
  if (!s || !source.length) return [];
  if (s.factor === 1) return source.length > bars ? source.slice(source.length - bars) : source.slice();
  const tail = source.length > (bars + 1) * s.factor ? source.slice(source.length - (bars + 1) * s.factor) : source;
  const out = resampleBars(tail, s.srcSec, s.srcSec * s.factor);
  return out.length > bars ? out.slice(out.length - bars) : out;
}
