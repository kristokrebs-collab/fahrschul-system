/**
 * The indicator contract and the check against a TradingView export (F64 / F14, pure).
 *
 * **Contract** (`INDICATORS`): for every indicator the lab calculates itself – name, the Pine call it corresponds to, its inputs with
 * defaults, the series it gives, from which candle on it has a value (`warmupOf`: MEASURED by running the real function on a test
 * series, not a hand-written number), how long a recursive smoothing needs until its starting value no longer matters (`settleBars`),
 * when a value is known (at the CLOSE of its candle: never repainted, tested), and what the number is checked against.
 *
 * **Check** (`compareIndicator`): the candles of a TradingView chart-data export are the SAME candles TradingView calculated on, so
 * the lab's own function is run on them and held against the plot column of the file, candle by candle. The verdict looks at the END
 * of the series: a recursive indicator (EMA, RSI, ATR …) starts from whatever history the chart had before the file's first candle, so
 * the beginning may differ and then converge – that is a different starting value, not a different formula, and the result says so.
 * A short file that has not settled yet is "offen", never "weicht ab". What matches here is valid for THIS market, period and timeframe
 * and these inputs – it is no general certificate.
 */
import { atrRma, cciSeries, dmiSeries, ichimokuSeries, keltnerSeries, stochSeries, williamsRSeries } from "../lab/rules/series";
import { bollingerSeries, macdSeries } from "../lab/rules/indicators";
import { ema, rsi, sma, type Bar } from "../signals/indicators";
import type { ChartColumn, ChartParse } from "./chart";

export type IndicatorId = "rsi" | "ema" | "sma" | "atr" | "macd" | "bollinger" | "adx" | "stoch" | "cci" | "williamsR" | "ichimoku" | "keltner";

export interface IndicatorParam {
  key: string;
  label: string;
  def: number;
  min: number;
  max: number;
  /** step of the input (1 = whole numbers) */
  step: number;
}

export interface IndicatorOutput {
  key: string;
  label: string;
  /** how TradingView usually names this plot in an export (compared without case and punctuation) */
  tv: readonly string[];
}

export type Inputs = Record<string, number>;
export type SeriesOf = Record<string, number[]>;

/** What the number is checked against. */
export type Validation = { kind: "tv"; on: string; note: string } | { kind: "definition"; note: string };

export interface IndicatorDef {
  id: IndicatorId;
  label: string;
  /** the Pine v6 call it corresponds to, with the inputs filled in */
  pine: (p: Inputs) => string;
  params: readonly IndicatorParam[];
  outputs: readonly IndicatorOutput[];
  compute: (bars: readonly Bar[], p: Inputs) => SeriesOf;
  /** candles after which a recursive smoothing has forgotten its starting value (≈ 1 part in 10 000), `null` = not recursive */
  settle: (p: Inputs) => number | null;
  /** how the first values come about */
  start: string;
  validation: Validation;
}

const P = (key: string, label: string, def: number, min: number, max: number, step = 1): IndicatorParam => ({ key, label, def, min, max, step });
const LEN = (def: number): IndicatorParam => P("len", "Länge", def, 1, 500);
/** after how many candles the weight of a starting value falls below 1 : 10 000 with a smoothing factor `alpha` */
const memory = (alpha: number): number => Math.ceil(Math.log(1e-4) / Math.log(1 - alpha));
const rmaMemory = (len: number): number => memory(1 / len);
const emaMemory = (len: number): number => memory(2 / (len + 1));
const num = (n: number): string => String(n).replace(".", ",");

const TV_FIXTURE = "gegen Werte aus TradingView geprüft (BINANCE:BTCUSDT 1D, 2026-10-19, Test lab.blocksPlus)";

export const INDICATORS: readonly IndicatorDef[] = [
  {
    id: "rsi",
    label: "RSI",
    pine: (p) => `ta.rsi(close, ${p.len})`,
    params: [LEN(14)],
    outputs: [{ key: "rsi", label: "RSI", tv: ["rsi"] }],
    compute: (bars, p) => ({ rsi: rsi(bars.map((b) => b.c), p.len!) }),
    settle: (p) => rmaMemory(p.len!),
    start: "Wilder-Glättung (RMA) der Gewinne und Verluste; der Startwert ist das Mittel der ersten Länge-Änderungen, wie bei Pine.",
    validation: { kind: "tv", on: "2026-10-19", note: TV_FIXTURE },
  },
  {
    id: "ema",
    label: "EMA",
    pine: (p) => `ta.ema(close, ${p.len})`,
    params: [LEN(20)],
    outputs: [{ key: "ema", label: "EMA", tv: ["ema"] }],
    compute: (bars, p) => ({ ema: ema(bars.map((b) => b.c), p.len!) }),
    settle: (p) => emaMemory(p.len!),
    start: "Der Startwert ist der erste Schluss der Datei (Pine nimmt das Mittel der ersten Länge-Kerzen): Der Anfang kann abweichen, nach der Einschwingzeit sind beide gleich.",
    validation: { kind: "definition", note: "nach der veröffentlichten Pine-Definition (ta.ema) nachgebaut; im MACD gegen TradingView-Werte mitgeprüft, allein nicht" },
  },
  {
    id: "sma",
    label: "SMA",
    pine: (p) => `ta.sma(close, ${p.len})`,
    params: [LEN(20)],
    outputs: [{ key: "sma", label: "SMA", tv: ["sma"] }],
    compute: (bars, p) => ({ sma: sma(bars.map((b) => b.c), p.len!) }),
    settle: () => null,
    start: "Ein Wert erst, wenn Länge Schlusskurse da sind; keine Rekursion, also kein Einschwingen.",
    validation: { kind: "tv", on: "2026-10-19", note: `${TV_FIXTURE} (als Mittellinie des Bollinger-Bandes)` },
  },
  {
    id: "atr",
    label: "ATR",
    pine: (p) => `ta.atr(${p.len})`,
    params: [LEN(14)],
    outputs: [{ key: "atr", label: "ATR", tv: ["atr"] }],
    compute: (bars, p) => ({ atr: atrRma(bars, p.len!) }),
    settle: (p) => rmaMemory(p.len!),
    start: "Wilder-Glättung (RMA) der True Range; die erste True Range ist Hoch minus Tief, der Startwert das Mittel der ersten Länge-Werte.",
    validation: { kind: "definition", note: "nach der veröffentlichten Pine-Definition (ta.atr) nachgebaut; auch im ADX, der gegen TradingView-Werte geprüft ist, aber allein nicht" },
  },
  {
    id: "macd",
    label: "MACD",
    pine: (p) => `ta.macd(close, ${p.fast}, ${p.slow}, ${p.signal})`,
    params: [P("fast", "Schnell", 12, 1, 200), P("slow", "Langsam", 26, 2, 400), P("signal", "Signal", 9, 1, 200)],
    outputs: [
      { key: "macd", label: "MACD-Linie", tv: ["macd", "macdline"] },
      { key: "sig", label: "Signallinie", tv: ["signal", "signalline"] },
      { key: "hist", label: "Histogramm", tv: ["histogram", "hist"] },
    ],
    compute: (bars, p) => macdSeries(bars.map((b) => b.c), p.fast!, p.slow!, p.signal!),
    settle: (p) => emaMemory(Math.max(p.slow!, p.signal!)),
    start: "Differenz zweier EMAs; die EMAs starten mit dem ersten Schluss (Pine: Mittel der ersten Kerzen) – der Anfang kann abweichen.",
    validation: { kind: "tv", on: "2026-10-19", note: `${TV_FIXTURE}; die Kerze der Quelle weicht dort leicht ab, die Toleranz des Tests ist groß` },
  },
  {
    id: "bollinger",
    label: "Bollinger-Bänder",
    pine: (p) => `ta.bb(close, ${p.len}, ${num(p.mult!)})`,
    params: [LEN(20), P("mult", "Faktor (σ)", 2, 0.1, 10, 0.1)],
    outputs: [
      { key: "mid", label: "Mittellinie", tv: ["basis"] },
      { key: "upper", label: "Oberes Band", tv: ["upper"] },
      { key: "lower", label: "Unteres Band", tv: ["lower"] },
    ],
    compute: (bars, p) => bollingerSeries(bars.map((b) => b.c), p.len!, p.mult!),
    settle: () => null,
    start: "Ein Wert erst, wenn Länge Schlusskurse da sind; die Standardabweichung ist die der Grundgesamtheit (wie Pine).",
    validation: { kind: "tv", on: "2026-10-19", note: TV_FIXTURE },
  },
  {
    id: "adx",
    label: "ADX / DI",
    pine: (p) => `ta.dmi(${p.len}, ${p.smooth})`,
    params: [P("len", "DI-Länge", 14, 1, 200), P("smooth", "ADX-Glättung", 14, 1, 200)],
    outputs: [
      { key: "plus", label: "+DI", tv: ["+di", "di+", "diplus"] },
      { key: "minus", label: "−DI", tv: ["-di", "di-", "diminus"] },
      { key: "adx", label: "ADX", tv: ["adx"] },
    ],
    compute: (bars, p) => dmiSeries(bars, p.len!, p.smooth!),
    settle: (p) => rmaMemory(p.len!) + rmaMemory(p.smooth!),
    start: "Wilder-Glättung (RMA) von True Range und Richtungsbewegung; der ADX braucht zusätzlich seine eigene Glättung.",
    validation: { kind: "tv", on: "2026-10-19", note: `${TV_FIXTURE} (stimmt auf Zehntel)` },
  },
  {
    id: "stoch",
    label: "Stochastik",
    pine: (p) => `ta.sma(ta.stoch(close, high, low, ${p.k}), ${p.ks})`,
    params: [P("k", "%K-Länge", 14, 1, 200), P("ks", "%K-Glättung", 1, 1, 50), P("ds", "%D-Glättung", 3, 1, 50)],
    outputs: [
      { key: "k", label: "%K", tv: ["%k", "k"] },
      { key: "d", label: "%D", tv: ["%d", "d"] },
    ],
    compute: (bars, p) => stochSeries(bars, p.k!, p.ks!, p.ds!),
    settle: () => null,
    start: "Ein Wert erst, wenn die %K-Länge voll ist; %D folgt nach seiner Glättung. Keine Rekursion.",
    validation: { kind: "tv", on: "2026-10-19", note: `${TV_FIXTURE} (mit %K-Glättung 3)` },
  },
  {
    id: "cci",
    label: "CCI",
    pine: (p) => `ta.cci(hlc3, ${p.len})`,
    params: [LEN(20)],
    outputs: [{ key: "cci", label: "CCI", tv: ["cci"] }],
    compute: (bars, p) => ({ cci: cciSeries(bars, p.len!) }),
    settle: () => null,
    start: "Ein Wert erst, wenn Länge typische Preise da sind; keine Rekursion.",
    validation: { kind: "tv", on: "2026-10-19", note: TV_FIXTURE },
  },
  {
    id: "williamsR",
    label: "Williams %R",
    pine: (p) => `ta.wpr(${p.len})`,
    params: [LEN(14)],
    outputs: [{ key: "r", label: "%R", tv: ["%r", "r", "williams%r"] }],
    compute: (bars, p) => ({ r: williamsRSeries(bars, p.len!) }),
    settle: () => null,
    start: "Ein Wert erst, wenn Länge Kerzen da sind; keine Rekursion.",
    validation: { kind: "tv", on: "2026-10-19", note: TV_FIXTURE },
  },
  {
    id: "ichimoku",
    label: "Ichimoku",
    pine: (p) => `ta.highest/lowest-Mittel ${p.conv} · ${p.base} · ${p.spanB}, Wolke um ${(p.shift ?? 26) - 1} Kerzen versetzt`,
    params: [P("conv", "Tenkan", 9, 1, 200), P("base", "Kijun", 26, 1, 400), P("spanB", "Senkou B", 52, 1, 600), P("shift", "Versatz", 26, 1, 200)],
    outputs: [
      { key: "tenkan", label: "Tenkan (Conversion Line)", tv: ["conversionline", "tenkan"] },
      { key: "kijun", label: "Kijun (Base Line)", tv: ["baseline", "kijun"] },
      { key: "cloudA", label: "Senkou A (Leading Span A)", tv: ["leadingspana", "senkoua"] },
      { key: "cloudB", label: "Senkou B (Leading Span B)", tv: ["leadingspanb", "senkoub"] },
    ],
    compute: (bars, p) => ichimokuSeries(bars, p.conv!, p.base!, p.spanB!, p.shift!),
    settle: () => null,
    start: "Mittel aus höchstem Hoch und tiefstem Tief; die Wolke gehört zu der Kerze, auf die sie gezeichnet wird (um den Versatz nach rechts verschoben). Keine Rekursion.",
    validation: { kind: "tv", on: "2026-10-19", note: `${TV_FIXTURE} (Tenkan, Kijun und Wolke)` },
  },
  {
    id: "keltner",
    label: "Keltner-Kanal",
    pine: (p) => `ta.kc(close, ${p.len}, ${num(p.mult!)}, true) mit ATR-Länge ${p.atrLen}`,
    params: [LEN(20), P("atrLen", "ATR-Länge", 10, 1, 200), P("mult", "Faktor", 2, 0.1, 10, 0.1)],
    outputs: [
      { key: "mid", label: "Mittellinie", tv: ["basis"] },
      { key: "upper", label: "Oberes Band", tv: ["upper"] },
      { key: "lower", label: "Unteres Band", tv: ["lower"] },
    ],
    compute: (bars, p) => keltnerSeries(bars, p.len!, p.atrLen!, p.mult!),
    settle: (p) => Math.max(emaMemory(p.len!), rmaMemory(p.atrLen!)),
    start: "EMA der Mitte ± Faktor mal ATR (exponentieller Durchschnitt, ATR nach Wilder); Anfang wie bei EMA und ATR.",
    validation: { kind: "definition", note: "nach der Definition des TradingView-Keltner-Kanals (EMA, ATR) nachgebaut, nicht gegen TradingView-Zahlen geprüft – der Abgleich hier prüft es mit deiner Datei" },
  },
];

export const indicatorById = (id: string): IndicatorDef | undefined => INDICATORS.find((d) => d.id === id);

export const defaultInputs = (d: IndicatorDef): Inputs => Object.fromEntries(d.params.map((p) => [p.key, p.def]));

/** The inputs clamped into their ranges (a missing or broken value falls back to the default). */
export function cleanInputs(d: IndicatorDef, raw: Record<string, unknown>): Inputs {
  const out: Inputs = {};
  for (const p of d.params) {
    const v = typeof raw[p.key] === "number" && Number.isFinite(raw[p.key]) ? (raw[p.key] as number) : p.def;
    const c = Math.min(p.max, Math.max(p.min, v));
    out[p.key] = p.step >= 1 ? Math.round(c) : Number((Math.round(c / p.step) * p.step).toFixed(6));
  }
  return out;
}

// ── what the contract says that was MEASURED ────────────────────────────────────────────────────────────────────

/** A fixed, reproducible test series (a seeded random walk with realistic candles): the same bars on every machine. */
export function testBars(n = 900): Bar[] {
  let seed = 20_261_019;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };
  const bars: Bar[] = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = Math.max(1, o * (1 + (rnd() - 0.5) * 0.04));
    const h = Math.max(o, c) * (1 + rnd() * 0.01);
    const l = Math.min(o, c) * (1 - rnd() * 0.01);
    bars.push({ t: 1_700_000_000 + i * 86_400, o, h, l, c, v: 1000 + Math.floor(rnd() * 500) });
    px = c;
  }
  return bars;
}

/** The candle (1-based) from which every series of the indicator has a value – measured by running the real function on a test series. */
export function warmupOf(d: IndicatorDef, p: Inputs = defaultInputs(d)): number | null {
  const s = d.compute(testBars(), p);
  let first = 0;
  for (const o of d.outputs) {
    const v = s[o.key];
    const at = v ? v.findIndex((x) => Number.isFinite(x)) : -1;
    if (at < 0) return null;
    first = Math.max(first, at);
  }
  return first + 1;
}

// ── column names → indicator ─────────────────────────────────────────────────────────────────────────────────

const normName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9%+-]/g, "");

/**
 * The (indicator, series) a plot name most likely is – only when exactly one fits; ambiguous names ("MA", "Basis", "Upper") give `null`.
 * A trailing number of an average ("EMA200") is taken as its length.
 */
export function guessColumn(name: string): { id: IndicatorId; output: string; inputs?: Inputs } | null {
  const n = normName(name);
  if (!n) return null;
  const avg = /^(ema|sma)(\d{1,3})$/.exec(n);
  if (avg) return { id: avg[1] as IndicatorId, output: avg[1]!, inputs: { len: Number(avg[2]) } };
  const hits: { id: IndicatorId; output: string }[] = [];
  for (const d of INDICATORS) for (const o of d.outputs) if (o.tv.includes(n)) hits.push({ id: d.id, output: o.key });
  return hits.length === 1 ? hits[0]! : null;
}

// ── the check ───────────────────────────────────────────────────────────────────────────────────────────────

export type Verdict = "equal" | "differs" | "open" | "few";

export interface Deviation {
  /** ms of the candle */
  time: number;
  tv: number;
  ours: number;
  diff: number;
}

export interface CompareStats {
  n: number;
  maxAbs: number;
  meanAbs: number;
  /** share of the values within the rounding of the export (0 … 1) */
  within: number;
}

export interface IndicatorCompare {
  indicator: IndicatorId;
  output: string;
  column: string;
  inputs: Inputs;
  /** candles in the file, values in the plot column, values of our calculation, candles where both have one */
  bars: number;
  tvValues: number;
  ourValues: number;
  compared: number;
  /** 1-based candle of the first value of TradingView's column / of ours (the visible start of the series) */
  tvStart: number | null;
  ourStart: number | null;
  /** the largest difference the export's own rounding explains (± half a unit of its last decimal) */
  tolerance: number;
  decimals: number;
  all: CompareStats | null;
  /** the last quarter of the compared values (at least 30) – the verdict looks here */
  tail: CompareStats | null;
  head: CompareStats | null;
  /** candles the recursion needs until its starting value no longer matters, `null` = not recursive; `settled` = the tail lies beyond it */
  settle: number | null;
  settled: boolean;
  verdict: Verdict;
  worst: Deviation[];
}

/** Ties the tolerance to what the file shows: half a unit of the last written decimal, plus 1 part in a billion of the value. */
const tolOf = (decimals: number, v: number): number => 0.5 * 10 ** -decimals * 1.0001 + Math.abs(v) * 1e-9;

function statsOf(diffs: readonly number[], tols: readonly number[]): CompareStats | null {
  if (!diffs.length) return null;
  let max = 0;
  let sum = 0;
  let within = 0;
  diffs.forEach((d, i) => {
    const a = Math.abs(d);
    if (a > max) max = a;
    sum += a;
    if (a <= tols[i]!) within++;
  });
  return { n: diffs.length, maxAbs: max, meanAbs: sum / diffs.length, within: within / diffs.length };
}

/** Holds the lab's own calculation against one plot column of a TradingView export. */
export function compareIndicator(chart: Pick<ChartParse, "bars">, col: ChartColumn, d: IndicatorDef, output: string, inputs: Inputs): IndicatorCompare {
  const p = cleanInputs(d, inputs);
  const ours = d.compute(chart.bars, p)[output] ?? [];
  const idx: number[] = [];
  for (let i = 0; i < chart.bars.length; i++) if (Number.isFinite(col.values[i]) && Number.isFinite(ours[i])) idx.push(i);
  const diffs = idx.map((i) => ours[i]! - col.values[i]!);
  const tols = idx.map((i) => tolOf(col.decimals, col.values[i]!));
  const tailN = Math.min(idx.length, Math.max(30, Math.ceil(idx.length * 0.25)));
  const cut = idx.length - tailN;
  const tail = statsOf(diffs.slice(cut), tols.slice(cut));
  const head = cut > 0 ? statsOf(diffs.slice(0, cut), tols.slice(0, cut)) : null;
  const all = statsOf(diffs, tols);
  const settle = d.settle(p);
  const tailStart = idx.length ? (idx[cut] ?? 0) - idx[0]! : 0;
  const settled = settle == null || tailStart >= settle;
  let verdict: Verdict;
  if (idx.length < 30) verdict = "few";
  else if (tail && tail.within === 1) verdict = "equal";
  else verdict = settled ? "differs" : "open";
  const worst = idx
    .map((i, k) => ({ time: chart.bars[i]!.t * 1000, tv: col.values[i]!, ours: ours[i]!, diff: diffs[k]! }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 5);
  const firstOf = (v: readonly number[]): number | null => {
    const at = v.findIndex((x) => Number.isFinite(x));
    return at < 0 ? null : at + 1;
  };
  return {
    indicator: d.id,
    output,
    column: col.name,
    inputs: p,
    bars: chart.bars.length,
    tvValues: col.filled,
    ourValues: ours.filter((x) => Number.isFinite(x)).length,
    compared: idx.length,
    tvStart: firstOf(col.values),
    ourStart: firstOf(ours),
    tolerance: idx.length ? tolOf(col.decimals, 0) : 0,
    decimals: col.decimals,
    all,
    tail,
    head,
    settle,
    settled,
    verdict,
    worst,
  };
}

/** The label of a verdict as the contract names the states. */
export const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  equal: "gleichwertig validiert",
  differs: "weicht ab",
  open: "offen – Datei zu kurz zum Einschwingen",
  few: "nicht vergleichbar – zu wenige Werte",
};
