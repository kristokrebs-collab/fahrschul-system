/**
 * Hand-built v2 evaluations for the Einstiegs-Check UI tests (card, strip, bias bar, falling-knife filter): checks
 * with candle-close states (`conf`, `forming`, `closesAt`), divergences, market structure and a Top-Trader reading,
 * graded by the real engine (`gradeSignals` = candle-close rule + parts + knife filter).
 */
import { bestVerdict, gradeSignals, NO_CONF, sanitizeSignalCfg, type Divergence, type RungConf, type SignalCfg, type SignalState, type Structure, type TfCheck, type TraderReading, type WtEvent, type ZoneInfo } from "@/domain/signals";
import type { LiveSignals } from "@/market";

export const UI_CFG: SignalCfg = sanitizeSignalCfg({});
export const M5 = 5 * 60_000;

export function zoneInfo(pos: number): ZoneInfo {
  const z = pos > 0.525 ? "premium" : pos >= 0.475 ? "equilibrium" : "discount";
  return { hi: 90_000, lo: 80_000, pos, zone: z, deep: pos <= 0.05 || pos >= 0.95, eq: 85_000, bias: 0, brk: null, lux: true };
}

export interface CheckOpts {
  long?: WtEvent;
  short?: WtEvent;
  /** candle-close state of the long event (default confirmed when `long` is set) */
  state?: SignalState;
  closes?: number;
  rsi?: number;
  pos?: number;
  /** the rung's last bar is forming and closes at this time (ms) */
  closesAt?: number;
  div?: Divergence[];
  structure?: Structure | null;
}

/** One rung with the v2 fields (`conf` for the long side; short = none unless `short` is set). */
export function v2check(tf: string, o: CheckOpts = {}): TfCheck {
  const rsi = o.rsi ?? 35;
  const long = o.long ?? null;
  const short = o.short ?? null;
  const latest = long ?? short;
  const st: SignalState = long ? (o.state ?? "confirmed") : "none";
  const conf = (ev: WtEvent, state: SignalState): RungConf =>
    !ev ? NO_CONF : { state, event: ev, closes: o.closes ?? (state === "provisional" ? 0 : 1), held: true, closed: state === "provisional" ? null : ev, forming: state === "provisional" ? ev : null };
  return {
    tf,
    ok: true,
    closeAt: 1_760_000_000,
    rsi,
    rsiMa: rsi + 1,
    wt: { kind: latest?.kind ?? null, barsAgo: latest?.barsAgo ?? null, long, short, wt1: -61.2, wt2: -58 },
    zone: zoneInfo(o.pos ?? 0.2),
    longSignal: !!long,
    shortSignal: !!short,
    rsiLong: rsi <= 40,
    rsiShort: rsi >= 60,
    forming: o.closesAt != null,
    closesAt: o.closesAt ?? 1_760_001_800_000,
    msToClose: 0,
    conf: { long: conf(long, st), short: conf(short, short ? "confirmed" : "none") },
    div: { all: o.div ?? [], long: (o.div ?? []).filter((d) => d.dir === 1), short: (o.div ?? []).filter((d) => d.dir === -1) },
    structure: o.structure ?? null,
  };
}

export function divHit(o: Partial<Divergence> = {}): Divergence {
  return {
    osc: "rsi",
    kind: "regular",
    dir: 1,
    from: { index: 10, t: 1_760_000_000, price: 81_240, osc: 28.1 },
    to: { index: 20, t: 1_760_018_000, price: 80_950, osc: 31.4 },
    at: 22,
    barsAgo: 2,
    state: "confirmed",
    held: true,
    active: true,
    ...o,
  };
}

/** A structure with one support below and one resistance above the close (100-based like the engine tests, scaled). */
export function structureAt(close: number, sup: { price: number; label?: string; distAtr: number } | null, res: { price: number; label?: string } | null, atr = 400): Structure {
  const lvl = (price: number, dir: 1 | -1, label: string, distAtr?: number) => ({ price, top: price, btm: price, kind: "swing" as const, dir, index: 1, t: 1, dist: Math.abs(close - price), distAtr: distAtr ?? Math.abs(close - price) / atr, label });
  const s = sup ? lvl(sup.price, 1, sup.label ?? "Demand-OB", sup.distAtr) : null;
  const r = res ? lvl(res.price, -1, res.label ?? "Swing-Hoch") : null;
  return { swings: [], breaks: [], obs: [], eqs: [], trend: 0, itrend: 0, supports: s ? [s] : [], resistances: r ? [r] : [], support: s, resistance: r, atr, close, last: 100 } as Structure;
}

export const traderReadingOf = (o: Partial<TraderReading> = {}): TraderReading => ({ at: 1_760_000_000_000, position: 66, account: 65.2, retail: 46, retailPrev: 46.5, retailChg: -0.5, period: "5m", step: M5, ...o });

/** Graded live snapshot from hand-built checks (the zone = the `zoneTf` rung). */
export function gradedSnapshot(checks: (TfCheck | null)[], traders: TraderReading | null = null, cfg: SignalCfg = UI_CFG): LiveSignals {
  const zone = checks.find((c) => c?.tf === cfg.zoneTf) ?? null;
  const base = { checks, zone, at: 1_760_000_000_000, ...bestVerdict(checks, cfg, zone), symbol: "BTCUSDT", source: "binance" as const, cfg, price: 81_200 };
  return gradeSignals(base, cfg, traders);
}
