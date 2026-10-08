/**
 * Expected Einstiegs-Check of the synthetic market (`synth.ts`) at a moment, computed with the app's own pure engine
 * (`src/domain/signals`) the way the market layer feeds it: exchange bars per source interval, resampled to the rung
 * (`rungBars` of `src/market/signals/bars.ts`, replicated here without the `@/` alias), the running bar completed
 * with the live price (bootstrap depths of `src/market/feeds.ts` BOOTSTRAP_LIMIT: 1500 × 15m, 499 × 1h / 4h), then graded
 * with the live Top-Trader reading: the three 5-minute ratio series (positions, accounts, all accounts — 36 points like
 * `LIVE_RATIO_BOOTSTRAP_LIMIT`) through `traderReading` → `computeSignals(bars, cfg, now, { traders })`. The spec compares
 * the card with this.
 */
import {
  DEFAULT_SIGNAL_CFG,
  computeSignals,
  resampleBars,
  sanitizeSignalCfg,
  SIGNAL_BARS,
  tfSeconds,
  traderReading,
  withLivePrice,
  type Bar,
  type SignalCfg,
  type Signals,
  type TraderSeries,
} from "../../../src/domain/signals";
import { SYNTH_LAST, synthKlines, synthRatios, type RatioKind, type RatioScript } from "./synth";

const SOURCE: Record<string, { interval: string; sec: number }> = {
  "30m": { interval: "15m", sec: 900 },
  "45m": { interval: "15m", sec: 900 },
  "1h": { interval: "1h", sec: 3600 },
  "2h": { interval: "1h", sec: 3600 },
  "4h": { interval: "4h", sec: 14_400 },
};

/** Points of each live 5-min ratio series on bootstrap (`LIVE_RATIO_BOOTSTRAP_LIMIT`). */
const TRADER_POINTS = 36;

function rungBars(tf: string, source: readonly Bar[]): Bar[] {
  const s = SOURCE[tf]!;
  const factor = tfSeconds(tf) / s.sec;
  if (factor === 1) return source.slice(-SIGNAL_BARS);
  const tail = source.slice(-(SIGNAL_BARS + 1) * factor);
  return resampleBars(tail, s.sec, s.sec * factor).slice(-SIGNAL_BARS);
}

/** The three live 5-min series the app reads for the Top-Trader-Kombi (time ms, long %). */
export function synthTraderSeries(ratios: RatioScript, now: number): TraderSeries {
  const pts = (kind: RatioKind) => synthRatios(kind, "5m", { limit: TRADER_POINTS }, ratios, now).map((x) => ({ time: Number(x.timestamp), longPct: Number(x.longAccount) * 100 }));
  return { position: pts("top-position"), account: pts("top-account"), retail: pts("global"), step: 300_000 };
}

export interface OracleOptions {
  /** stored `settings.signals` (sanitised like the app does); default = the engine defaults */
  cfg?: Partial<SignalCfg> | Record<string, unknown>;
  /** the price path mirrored around the live price (`bias.spec` short setup: p' = 2 · SYNTH_LAST − p) */
  mirror?: boolean;
}

/** The evaluation the app shows for the synthetic market anchored at `anchor`, evaluated at `now` with `livePrice`. */
export function expectedSignals(anchor: number, now: number, livePrice: number, ratios: RatioScript, opts: OracleOptions = {}): Signals {
  const cfg = sanitizeSignalCfg({ ...DEFAULT_SIGNAL_CFG, ...(opts.cfg ?? {}) } as SignalCfg);
  const m = (x: string) => (opts.mirror ? 2 * SYNTH_LAST - Number(x) : Number(x));
  const bars: Record<string, Bar[]> = {};
  for (const tf of [...new Set([...cfg.ladder, cfg.zoneTf])]) {
    const s = SOURCE[tf];
    if (!s) throw new Error(`synthetic market: no source for ${tf}`);
    const src: Bar[] = synthKlines(s.interval, { limit: s.interval === "15m" ? 1500 : 499 }, anchor, now).map((r) => ({
      t: r[0] / 1000,
      o: m(r[1]),
      h: opts.mirror ? m(r[3]) : m(r[2]),
      l: opts.mirror ? m(r[2]) : m(r[3]),
      c: m(r[4]),
      v: +r[5],
    }));
    bars[tf] = withLivePrice(rungBars(tf, src), tfSeconds(tf), livePrice, now) as Bar[];
  }
  const traders = traderReading(synthTraderSeries(ratios, now), cfg, now);
  const sig = computeSignals(bars, cfg, now, { traders });
  if (!sig) throw new Error("synthetic market: no evaluation");
  return sig;
}
