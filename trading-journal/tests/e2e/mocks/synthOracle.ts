/**
 * Expected Einstiegs-Check of the synthetic market (`synth.ts`) at a moment, computed with the app's own pure engine
 * (`src/domain/signals`) the way the market layer feeds it: exchange bars per source interval, resampled to the rung
 * (`rungBars` of `src/market/signals/bars.ts`, replicated here without the `@/` alias), the running bar completed
 * with the live price (bootstrap depths of `src/market/feeds.ts` BOOTSTRAP_LIMIT: 1500 × 15m, 499 × 1h / 4h), then graded with the top-trader / retail readings. The spec compares the card with this.
 */
import {
  applyWhale,
  DEFAULT_SIGNAL_CFG,
  computeSignals,
  resampleBars,
  sanitizeSignalCfg,
  SIGNAL_BARS,
  tfSeconds,
  whaleReading,
  withLivePrice,
  type Bar,
  type Signals,
  type WhaleSeries,
} from "../../../src/domain/signals";
import { synthKlines, synthRatios, type RatioScript } from "./synth";

const SOURCE: Record<string, { interval: string; sec: number }> = {
  "30m": { interval: "15m", sec: 900 },
  "45m": { interval: "15m", sec: 900 },
  "1h": { interval: "1h", sec: 3600 },
  "4h": { interval: "4h", sec: 14_400 },
};

function rungBars(tf: string, source: readonly Bar[]): Bar[] {
  const s = SOURCE[tf]!;
  const factor = tfSeconds(tf) / s.sec;
  if (factor === 1) return source.slice(-SIGNAL_BARS);
  const tail = source.slice(-(SIGNAL_BARS + 1) * factor);
  return resampleBars(tail, s.sec, s.sec * factor).slice(-SIGNAL_BARS);
}

/** The evaluation the app shows for the synthetic market anchored at `anchor`, evaluated at `now` with `livePrice`. */
export function expectedSignals(anchor: number, now: number, livePrice: number, ratios: RatioScript): Signals {
  const cfg = sanitizeSignalCfg(DEFAULT_SIGNAL_CFG);
  const bars: Record<string, Bar[]> = {};
  for (const tf of [...new Set([...cfg.ladder, cfg.zoneTf])]) {
    const s = SOURCE[tf]!;
    const src: Bar[] = synthKlines(s.interval, { limit: s.interval === "15m" ? 1500 : 499 }, anchor, now).map((r) => ({ t: r[0] / 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }));
    bars[tf] = withLivePrice(rungBars(tf, src), tfSeconds(tf), livePrice, now) as Bar[];
  }
  const sig = computeSignals(bars, cfg, now);
  if (!sig) throw new Error("synthetic market: no evaluation");
  const series: Record<string, WhaleSeries> = {};
  for (const p of ["30m", "1h"]) {
    const pts = (kind: "top-position" | "global") => synthRatios(kind, p, { limit: 30 }, ratios, now).map((x) => ({ time: Number(x.timestamp), longPct: Number(x.longAccount) * 100 }));
    series[p] = { top: pts("top-position"), retail: pts("global") };
  }
  return applyWhale(sig, whaleReading(series, cfg, now), cfg);
}
