/**
 * One chart through the pre-filter and the chosen setups. Pure: candles in, hits and a reason for every chart that was
 * left out out. The pre-filter is the first honest question – is this chart worth looking at at all? (price, volume,
 * listing status, enough recent candles) – and it runs before any rule so the numbers of "scanned / skipped" mean what
 * they say.
 */
import { flagSetup, orbSetup, rsiSetup, completeBars, type SessionCtx, type SetupResult, type SymbolCtx } from "./setups";
import { DEFAULT_PARAMS, PARAM_LIMITS, type Hit, type ScanCandle, type ScanParams, type SetupId, type SkipReason, type Stand, type SymbolScan } from "./types";

export interface ScanInput {
  symbol: string;
  name?: string | null;
  /** Nasdaq financial status (`N` = normal); `undefined` / `null` = not applicable (crypto, NYSE listings) */
  fin?: string | null;
  interval: string;
  /** candle length in ms */
  barMs: number;
  candles: readonly ScanCandle[];
  /** the moment the candles were fetched (decides which are complete and how old the newest is) */
  asOf: number;
  /** the session ORB looks at */
  session?: SessionCtx;
  stand: Stand;
}

const DAY = 86_400_000;
const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Any stored / typed parameters → a full set inside the allowed bounds (unknown or broken values fall back to the default). */
export function sanitizeParams(raw: unknown): ScanParams {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const d = DEFAULT_PARAMS;
  const L = PARAM_LIMITS;
  const o = r.orb ?? {};
  const f = r.flag ?? {};
  const s = r.rsi ?? {};
  const p = r.pre ?? {};
  const sides = o.sides === "short" || o.sides === "both" || o.sides === "long" ? o.sides : d.orb.sides;
  const latest = o.latestMinutes === null ? null : clamp(num(o.latestMinutes, d.orb.latestMinutes ?? 360), L.latestMinutes);
  return {
    orb: {
      orMinutes: Math.round(clamp(num(o.orMinutes, d.orb.orMinutes), L.orMinutes) / 5) * 5,
      sides,
      minBreak: clamp(num(o.minBreak, d.orb.minBreak), L.minBreak),
      latestMinutes: latest,
      stillBeyond: typeof o.stillBeyond === "boolean" ? o.stillBeyond : d.orb.stillBeyond,
      minRelVolume: clamp(num(o.minRelVolume, d.orb.minRelVolume), L.minRelVolume),
    },
    flag: {
      poleBars: Math.round(clamp(num(f.poleBars, d.flag.poleBars), L.poleBars)),
      poleMinGain: clamp(num(f.poleMinGain, d.flag.poleMinGain), L.poleMinGain),
      flagBars: Math.round(clamp(num(f.flagBars, d.flag.flagBars), L.flagBars)),
      flagMaxRange: clamp(num(f.flagMaxRange, d.flag.flagMaxRange), L.flagMaxRange),
    },
    rsi: {
      length: Math.round(clamp(num(s.length, d.rsi.length), L.rsiLength)),
      level: clamp(num(s.level, d.rsi.level), L.rsiLevel),
      requireBounce: typeof s.requireBounce === "boolean" ? s.requireBounce : d.rsi.requireBounce,
    },
    pre: {
      minPrice: clamp(num(p.minPrice, d.pre.minPrice), L.minPrice),
      minVolume: clamp(num(p.minVolume, d.pre.minVolume), L.minVolume),
      normalStatusOnly: typeof p.normalStatusOnly === "boolean" ? p.normalStatusOnly : d.pre.normalStatusOnly,
      minBars: Math.round(clamp(num(p.minBars, d.pre.minBars), L.minBars)),
      maxAgeDays: Math.round(clamp(num(p.maxAgeDays, d.pre.maxAgeDays), L.maxAgeDays)),
    },
  };
}

/** The pre-filter: `null` = worth a look, else why not. Volume rule: the last complete daily bar, or the session so far. */
export function prefilter(input: ScanInput, params: ScanParams, intraday: boolean): { skip: SkipReason; detail?: string } | null {
  const pre = params.pre;
  if (pre.normalStatusOnly && input.fin != null && input.fin !== "" && input.fin !== "N") return { skip: "status", detail: `Finanzstatus ${input.fin}` };
  const bars = completeBars(input.candles);
  const last = bars[bars.length - 1];
  if (!last) return { skip: "few-bars", detail: "keine vollständige Kerze" };
  if (!intraday) {
    if (bars.length < pre.minBars) return { skip: "few-bars", detail: `${bars.length} von mindestens ${pre.minBars} Kerzen` };
    const age = (input.asOf - (last.time + input.barMs)) / DAY;
    if (age > pre.maxAgeDays) return { skip: "stale", detail: `letzte Kerze vor ${Math.floor(age)} Tagen` };
  }
  if (pre.minPrice > 0 && last.close < pre.minPrice) return { skip: "price", detail: `Schluss ${last.close} unter ${pre.minPrice}` };
  if (pre.minVolume > 0) {
    let vol: number;
    if (intraday && input.session) {
      const s = input.session;
      vol = bars.filter((b) => b.time >= s.openMs && b.time < s.closeMs).reduce((a, b) => a + (typeof b.volume === "number" ? b.volume : 0), 0);
    } else vol = typeof last.volume === "number" ? last.volume : 0;
    if (vol < pre.minVolume) return { skip: "volume", detail: `Volumen ${Math.round(vol)} unter ${pre.minVolume}` };
  }
  return null;
}

/** One chart: pre-filter, then every chosen setup. A setup that cannot run (too few bars) does not hide the others. */
export function scanSymbol(input: ScanInput, params: ScanParams, setups: readonly SetupId[]): SymbolScan {
  const intraday = setups.includes("orb");
  const sk = prefilter(input, params, intraday);
  if (sk) return { symbol: input.symbol, hits: [], skipped: sk.skip, ...(sk.detail ? { detail: sk.detail } : {}) };
  const ctx: SymbolCtx = { symbol: input.symbol, name: input.name ?? null, barMs: input.barMs, interval: input.interval, stand: input.stand };
  const hits: Hit[] = [];
  let skipped: SkipReason | null = null;
  let detail: string | undefined;
  let ran = 0;
  for (const id of setups) {
    let r: SetupResult;
    if (id === "orb") {
      if (!input.session) {
        skipped = "no-session";
        continue;
      }
      r = orbSetup(ctx, input.candles, input.session, params.orb, input.asOf);
    } else if (id === "flag") r = flagSetup(ctx, input.candles, params.flag);
    else r = rsiSetup(ctx, input.candles, params.rsi);
    if (r.skip) {
      skipped = r.skip;
      detail = r.detail;
      continue;
    }
    ran++;
    hits.push(...r.hits);
  }
  // a chart counts as scanned when at least one setup could run on it; it is skipped only when none could
  return { symbol: input.symbol, hits, skipped: ran > 0 ? null : skipped, ...(ran === 0 && detail ? { detail } : {}) };
}

/** Sort keys of the result list. */
export type RankBy = "turnover" | "metric" | "symbol";

export const RANK_NAME: Readonly<Record<RankBy, string>> = { turnover: "Handelsumsatz", metric: "Kennzahl des Setups", symbol: "Kürzel A–Z" };

/**
 * Orders hits. Turnover (price × volume) puts the most traded charts first – the order of the trader-scanner skill; it
 * says how liquid a chart is, not how good the setup is. `metric`: the setup's own number, strongest first (for the RSI
 * the lowest value).
 */
export function rankHits(hits: readonly Hit[], by: RankBy): Hit[] {
  const out = [...hits];
  const bySymbol = (a: Hit, b: Hit): number => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : a.setup < b.setup ? -1 : 1);
  if (by === "symbol") return out.sort(bySymbol);
  if (by === "turnover") return out.sort((a, b) => (b.turnover ?? -1) - (a.turnover ?? -1) || bySymbol(a, b));
  // the numbers of different setups are not comparable (a percentage, an RSI): by setup first, then the strongest of each
  const order: Record<SetupId, number> = { orb: 0, flag: 1, rsi: 2 };
  return out.sort((a, b) => order[a.setup] - order[b.setup] || (a.setup === "rsi" ? a.metric.value - b.metric.value : b.metric.value - a.metric.value) || bySymbol(a, b));
}
