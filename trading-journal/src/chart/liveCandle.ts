/**
 * Live forming candle: every trade print moves the last bar between kline frames.
 *
 * Inputs (all coalesced to at most one delivery per animation frame upstream):
 * - trades (`priceMv` + `tradeTimeMv`): the raw price widens high/low at once and the close glides there on
 *   `spring.candle`; the first print of the next bucket opens a new bar;
 * - klines (`subscribeFeed`) and history tails: authoritative OHLC, volume and new bars. A kline that is older than the
 *   last trade merged into the same bar never pulls the close back: its range is merged and the live close kept;
 * - the traded-volume stream grows the forming bar's volume between klines.
 *
 * The series is written once per frame (`frame.render`) and only while the chart is active (ready, on screen, not
 * collapsed). While inactive the bars stay current in memory and every touched bar is replayed on resume.
 */
import { attachSpring, cancelFrame, frame, motionValue, type MotionValue } from "motion/react";
import type { CandlestickData, HistogramData, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/market/types";
import { spring } from "@/motion/tokens";
import { INTERVAL_SECONDS, sec, toCandleData, volumeColor, type ChartInterval } from "./panes";

export type Bar = CandlestickData<UTCTimestamp>;

const WEEK_OFFSET_MS = 4 * 86_400_000;

/**
 * Open time (ms UTC) of the bucket that contains `ms`. Minute/hour buckets are epoch aligned; weekly buckets open on
 * Monday 00:00 UTC like Binance's (the Unix epoch was a Thursday, hence the 4-day offset).
 */
export function bucketOpen(ms: number, interval: ChartInterval): number {
  const iv = INTERVAL_SECONDS[interval] * 1000;
  const offset = interval === "1w" ? WEEK_OFFSET_MS : 0;
  return Math.floor((ms - offset) / iv) * iv + offset;
}

export type TradeStep = "merge" | "open" | "skip";

/**
 * What a print at `tradeMs` does to a chart whose last bar opens at `lastSec`: merge into it, open the immediately
 * following bar, or nothing (unknown time, a print older than the last bar, or a gap the kline stream must fill).
 */
export function tradeStep(lastSec: number, tradeMs: number, interval: ChartInterval): TradeStep {
  if (!(tradeMs > 0)) return "skip";
  const open = sec(bucketOpen(tradeMs, interval));
  if (open === lastSec) return "merge";
  if (open === lastSec + INTERVAL_SECONDS[interval]) return "open";
  return "skip";
}

/** `bar` with a new close; high/low always enclose open, close and `raw` (the print that moved it). */
export function withClose(bar: Bar, close: number, raw: number = close): Bar {
  return {
    time: bar.time,
    open: bar.open,
    high: Math.max(bar.high, bar.open, close, raw),
    low: Math.min(bar.low, bar.open, close, raw),
    close,
  };
}

/**
 * Kline vs live bar. While the trade stream is ahead of the kline (`tradeAhead`), the kline only widens the range and
 * the live close stays, so a 250 ms old kline cannot yank the candle backwards; otherwise the kline wins.
 */
export function reconcileBar(kline: Bar, live: Bar | undefined, tradeAhead: boolean): Bar {
  if (!tradeAhead || !live || live.time !== kline.time) return kline;
  return {
    time: kline.time,
    open: kline.open,
    high: Math.max(kline.high, live.high, live.close),
    low: Math.min(kline.low, live.low, live.close),
    close: live.close,
  };
}

/** More new bars than this in one history update → full `setData` (the live engine appends only a few at a time). */
export const MAX_TAIL_APPEND = 2;

/**
 * Whether `next` is `prev` plus at most `maxNew` newer bars on the right (same first bar, `prev`'s last bar at the
 * same index). Such a history update is appended through the live engine instead of a full `setData`.
 */
export function extendsTail(prev: readonly { time: number }[], next: readonly { time: number }[], maxNew = MAX_TAIL_APPEND): boolean {
  const p0 = prev[0];
  const n0 = next[0];
  const pl = prev[prev.length - 1];
  if (!p0 || !n0 || !pl || p0.time !== n0.time) return false;
  if (next.length < prev.length || next.length - prev.length > maxNew) return false;
  return next[prev.length - 1]?.time === pl.time;
}

const sameBar = (a: Bar | null, b: Bar): boolean =>
  a !== null && a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;

export interface LiveTarget {
  candles: { update(bar: Bar, historicalUpdate?: boolean): void };
  volume: { update(bar: HistogramData<UTCTimestamp>, historicalUpdate?: boolean): void };
}

export interface LiveHost {
  /** The chart's bars, ascending; the engine rewrites the tail and appends in place. */
  data: Bar[];
}

export interface TradeStream {
  price: MotionValue<number>;
  /** Exchange time (ms) of the print in `price`; set before `price` in the same frame. */
  tradeTime: MotionValue<number>;
  /** Monotonic traded volume (base units). */
  volume?: MotionValue<number>;
}

export interface LiveCandleOptions {
  host: LiveHost;
  target: LiveTarget;
  /** Whether the series may be written now (ready, on screen, not collapsed). */
  isActive: () => boolean;
  /** Glide the close (`false` → jump: reduced motion, or no trade stream to smooth). */
  isSmooth: () => boolean;
  /** Smallest visible price step; closer glide frames are not pushed (except the one landing on the print). */
  minMove: number;
  /** After bars were appended (bounds / sub-pane grid). */
  onAppend: () => void;
  /** After the series received the forming bar. */
  onPush: (bar: Bar) => void;
  /** Frame scheduler (tests inject a manual one). */
  schedule?: (cb: () => void) => () => void;
}

const renderStep = (cb: () => void): (() => void) => {
  frame.render(cb);
  return () => cancelFrame(cb);
};

export class LiveCandle {
  /** Displayed close of the forming bar. */
  readonly close: MotionValue<number> = motionValue(0);
  private readonly detachSpring: VoidFunction;
  private readonly offClose: VoidFunction;
  private readonly schedule: (cb: () => void) => () => void;
  private interval: ChartInterval = "1h";
  private stream: TradeStream | null = null;
  /** Last raw print, the bar (open, s) it was merged into and its exchange time (ms). */
  private raw = 0;
  private rawBar = -1;
  private tradeAt = 0;
  /** Kline volume of the forming bar and the volume-stream reading when it arrived. */
  private kVolume = 0;
  private kVolumeAt = 0;
  /** Final volumes of touched closed bars, pushed with them. */
  private readonly volumes = new Map<number, number>();
  /** Bars the series holds (`data.length` at the last push) and the first index it has not seen in its current state. */
  private pushedCount = 0;
  private dirtyFrom = Infinity;
  private pushedTail: Bar | null = null;
  private pushedVolume = Number.NaN;
  private cancel: (() => void) | null = null;

  constructor(private readonly o: LiveCandleOptions) {
    this.schedule = o.schedule ?? renderStep;
    // a follower without a source: `set` glides on spring.candle, `jump` snaps
    this.detachSpring = attachSpring(this.close, 0, spring.candle);
    this.offClose = this.close.on("change", this.request);
  }

  /** After `setData`: the history's last bar becomes the forming bar. */
  reset(interval: ChartInterval, lastVolume: number): void {
    const data = this.o.host.data;
    const last = data[data.length - 1];
    this.interval = interval;
    this.raw = 0;
    this.rawBar = -1;
    this.tradeAt = 0;
    this.kVolume = lastVolume;
    this.kVolumeAt = this.volumeNow();
    this.volumes.clear();
    this.pushedCount = data.length;
    this.dirtyFrom = Infinity;
    this.pushedTail = last ?? null;
    this.pushedVolume = lastVolume;
    if (last) this.close.jump(last.close);
  }

  /** Follows a trade stream; returns the disconnect. */
  connect(stream: TradeStream): () => void {
    this.stream = stream;
    const off = stream.price.on("change", (p) => this.trade(p, stream.tradeTime.get()));
    return () => {
      off();
      if (this.stream === stream) this.stream = null;
    };
  }

  /** One print (`p` raw price, `t` exchange time in ms). */
  trade(p: number, t: number): void {
    if (!(p > 0) || !Number.isFinite(p)) return; // 0 = symbol switch reset
    const data = this.o.host.data;
    const i = data.length - 1;
    const last = data[i];
    if (!last) return;
    const step = tradeStep(last.time, t, this.interval);
    if (step === "skip") return;
    if (step === "open") {
      // the previous bar closes on its last print, the new one opens on this one
      data[i] = withClose(last, this.rawBar === last.time ? this.raw : last.close);
      this.volumes.set(last.time, this.formingVolume());
      data.push({ time: (last.time + INTERVAL_SECONDS[this.interval]) as UTCTimestamp, open: p, high: p, low: p, close: p });
      this.touch(i);
      this.kVolume = 0;
      this.kVolumeAt = this.volumeNow();
      this.close.jump(p);
      this.o.onAppend();
    } else {
      if (p > last.high || p < last.low) data[i] = { ...last, high: Math.max(last.high, p), low: Math.min(last.low, p) };
      this.retarget(p);
    }
    this.raw = p;
    this.rawBar = (data[data.length - 1] as Bar).time;
    this.tradeAt = t;
    this.request();
  }

  /** Kline delivery or history tail (ascending, ms open times); `asOf` = exchange time it describes (0 = unknown). */
  bars(bars: readonly Candle[], asOf: number): void {
    const data = this.o.host.data;
    const first = data[data.length - 2] ?? data[data.length - 1];
    if (!first || bars.length === 0) return;
    // every delivered bar from the chart's previous-to-last bar onward: 2–3 in steady state; after a gap (hidden tab,
    // WS outage) the bar that was forming before it gets its final kline and every new bar is appended once
    let from = bars.length;
    while (from > 0 && sec((bars[from - 1] as Candle).time) >= first.time) from--;
    let appended = false;
    for (let k = from; k < bars.length; k++) {
      const c = bars[k] as Candle;
      const kb = toCandleData(c);
      const i = data.length - 1;
      const last = data[i] as Bar;
      if (kb.time === last.time) {
        const ahead = this.rawBar === kb.time && this.tradeAt > asOf;
        const next = reconcileBar(kb, last, ahead);
        data[i] = next;
        this.touch(i);
        if (!ahead) {
          this.retarget(next.close);
          // the kline is the newest known price of this bar: it, not an older print, closes the bar on rollover
          if (this.rawBar === kb.time) this.raw = next.close;
        }
        this.kVolume = c.volume;
        this.kVolumeAt = this.volumeNow();
      } else if (kb.time > last.time) {
        this.volumes.set(last.time, this.formingVolume());
        data.push(kb);
        this.touch(i + 1);
        this.close.jump(kb.close);
        this.kVolume = c.volume;
        this.kVolumeAt = this.volumeNow();
        appended = true;
      } else if (i > 0 && kb.time === (data[i - 1] as Bar).time) {
        // the bar that just closed: its kline holds the final OHLC
        data[i - 1] = kb;
        this.volumes.set(kb.time, c.volume);
        this.touch(i - 1);
      }
    }
    if (appended) this.o.onAppend();
    this.request();
  }

  /** Re-push after an inactive period (or a forced redraw). */
  resume(): void {
    this.request();
  }

  dispose(): void {
    this.cancel?.();
    this.cancel = null;
    this.offClose();
    this.detachSpring();
    this.close.destroy();
    this.stream = null;
  }

  private retarget(close: number): void {
    if (this.o.isSmooth()) this.close.set(close);
    else this.close.jump(close);
  }

  private touch(i: number): void {
    if (i < this.dirtyFrom) this.dirtyFrom = i;
  }

  private volumeNow(): number {
    return this.stream?.volume?.get() ?? 0;
  }

  private formingVolume(): number {
    return this.kVolume + Math.max(0, this.volumeNow() - this.kVolumeAt);
  }

  private readonly request = (): void => {
    if (this.cancel) return;
    this.cancel = this.schedule(this.apply);
  };

  private readonly apply = (): void => {
    this.cancel = null;
    const data = this.o.host.data;
    const i = data.length - 1;
    const last = data[i];
    if (!last) return;
    // quantised to the price grid (float-safe multiply-then-divide): the last-price label never shows sub-tick values
    const inv = 1 / this.o.minMove;
    const c = Math.round(this.close.get() * inv) / inv;
    const tail = c > 0 && c !== last.close ? withClose(last, c) : last;
    data[i] = tail;
    if (!this.o.isActive()) {
      if (tail !== last) this.touch(i);
      return;
    }
    const volume = this.formingVolume();
    const prev = this.pushedTail;
    const settled =
      this.dirtyFrom > i &&
      prev !== null &&
      volume === this.pushedVolume &&
      (sameBar(prev, tail) ||
        (prev.time === tail.time && prev.open === tail.open && prev.high === tail.high && prev.low === tail.low && Math.abs(prev.close - tail.close) < this.o.minMove / 2 && tail.close !== this.raw));
    if (settled) return;
    const { candles, volume: vol } = this.o.target;
    // touched earlier bars first: older than the series' last bar → historical update, newer → append
    for (let k = Math.min(this.dirtyFrom, i); k < i; k++) {
      const bar = data[k] as Bar;
      const historical = k < this.pushedCount - 1;
      candles.update(bar, historical);
      const v = this.volumes.get(bar.time);
      if (v !== undefined || !historical) vol.update({ time: bar.time, value: v ?? 0, color: volumeColor(bar.open, bar.close) }, historical);
    }
    candles.update(tail);
    vol.update({ time: tail.time, value: volume, color: volumeColor(tail.open, tail.close) });
    this.pushedCount = data.length;
    this.dirtyFrom = Infinity;
    this.volumes.clear();
    this.pushedTail = tail;
    this.pushedVolume = volume;
    this.o.onPush(tail);
  };
}
