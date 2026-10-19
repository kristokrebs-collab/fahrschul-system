/**
 * Which key-level timeframes the market feed can actually serve, and why one cannot be chosen. Pure.
 *
 * | Level timeframe | Built from | Feed |
 * |---|---|---|
 * | 30m | 2 × 15m | `kline_15m` |
 * | 1h | 1h | `kline_1h` |
 * | 2h, 3h | 2 × / 3 × 1h | `kline_1h` |
 * | 4h | 4h | `kline_4h` |
 * | 1D | 1D | `kline_1d` (REST, hourly) |
 * | 1W | 1W | `kline_1w` |
 *
 * A timeframe the feed cannot serve right now is shown DISABLED with the reason – it is never swapped for another one.
 */
import { KEY_TF_MS, KEY_TIMEFRAMES, type KeyTf } from "./types";

export type TfFeed = "kline_15m" | "kline_1h" | "kline_4h" | "kline_1d" | "kline_1w";

export interface TfSource {
  feed: TfFeed;
  /** length of one source candle, ms */
  srcMs: number;
  /** German name of the candle series */
  label: string;
}

const MIN = 60_000;
export const KEY_TF_SOURCE: Readonly<Record<KeyTf, TfSource>> = {
  "30m": { feed: "kline_15m", srcMs: 15 * MIN, label: "15m-Kerzen" },
  "1h": { feed: "kline_1h", srcMs: 60 * MIN, label: "1h-Kerzen" },
  "2h": { feed: "kline_1h", srcMs: 60 * MIN, label: "1h-Kerzen" },
  "3h": { feed: "kline_1h", srcMs: 60 * MIN, label: "1h-Kerzen" },
  "4h": { feed: "kline_4h", srcMs: 240 * MIN, label: "4h-Kerzen" },
  "1D": { feed: "kline_1d", srcMs: 1440 * MIN, label: "1D-Kerzen" },
  "1W": { feed: "kline_1w", srcMs: 7 * 1440 * MIN, label: "1W-Kerzen" },
};

/** What the market layer knows about one candle feed. */
export interface FeedAvailability {
  /** candles in the ring */
  count: number;
  /** the source cannot serve this feed at all (`reason: "unsupported"`) */
  unsupported?: boolean;
  /** feed health is `offline` */
  offline?: boolean;
  /** German detail of the feed health, if any */
  detail?: string;
}

export type FeedAvailabilityMap = Partial<Record<TfFeed, FeedAvailability>>;

export interface TfAvailability {
  tf: KeyTf;
  ok: boolean;
  /** German reason when `ok` is false */
  reason: string | null;
}

/** Source candles needed for one candle of `tf` (30m: 2, 2h: 2, 3h: 3 …). */
export const sourcePerBar = (tf: KeyTf): number => Math.max(1, Math.round(KEY_TF_MS[tf] / KEY_TF_SOURCE[tf].srcMs));

/**
 * Availability of every timeframe. `feeds === null` = the live market is not running (settings loading, market off):
 * nothing can be evaluated, so nothing is offered as available – the reason says so.
 */
export function timeframeAvailability(feeds: FeedAvailabilityMap | null): TfAvailability[] {
  return KEY_TIMEFRAMES.map((tf) => {
    const src = KEY_TF_SOURCE[tf];
    if (!feeds) return { tf, ok: false, reason: "Der Live-Markt läuft nicht – die Zeiteinheit lässt sich nicht prüfen." };
    const f = feeds[src.feed];
    if (!f) return { tf, ok: false, reason: `${src.label} sind noch nicht geladen.` };
    if (f.unsupported) return { tf, ok: false, reason: `Die aktuelle Datenquelle liefert keine ${src.label}.` };
    if (f.count < sourcePerBar(tf)) {
      return { tf, ok: false, reason: f.offline ? `Keine ${src.label} – Quelle offline.` : f.detail ? `${f.detail}` : `${src.label} werden geladen …` };
    }
    return { tf, ok: true, reason: null };
  });
}

/** `4h` → `4H`-style label used in sentences (`1D`, `1W` stay as they are). */
export const tfLabel = (tf: KeyTf): string => (tf === "1D" || tf === "1W" ? tf : tf.toUpperCase());
