/**
 * Pine export (F14 / F64): `toPine(config, options)` turns the rule tree of "Eigene Idee" into a readable Pine Script v6
 * STRATEGY the trader pastes into TradingView's Pine editor – the honest way to look at the same rules on TradingView's
 * own candles and its own strategy tester (whose export the lab can read back, see `@/domain/tvimport`).
 *
 * Honesty rules:
 * - Every building block that can be written with `ta.*` is translated 1:1 to the lab's definition (the lab's own tests pin
 *   the maths against TradingView values). A block that cannot be translated is NEVER dropped silently: it is listed by name
 *   (`gaps`, and in the header of the script) and its place in the rule tree becomes an `input.bool` that defaults to
 *   `false` – the script then does not trade until the trader decides what that condition should be.
 * - Differences that remain are listed in the script header (`notes`): candle source, one fee for all fills, slippage in
 *   ticks, the order of high and low inside a candle, signals the lab skips at gaps, funding.
 * - The app cannot run or compile Pine. The text follows the v6 reference; if TradingView reports an error, it is in the
 *   script's own syntax and shown there.
 *
 * Pure: no I/O, no clock (the stamp is passed in), deterministic – snapshot-tested.
 */
import { BLOCKS } from "../rules/blocks";
import { activeLeaves, leavesOf, nodeText, sidesOf, stopText, exitsText } from "../rules/tree";
import type { SignalCfg } from "../../signals/config";
import type { SlippageModel } from "../../backtest/types";
import { DEFAULT_SIGNAL_CFG } from "../../signals/config";
import { TF_LABEL, TF_SEC, type BlockId, type CustomConfig, type Group, type Leaf, type LeafParams, type Node, type ParamDef, type TfId } from "../rules/types";

/** The cost / sizing set-up of the lab run the script mirrors. */
export interface PineEngine {
  capital: number;
  /** percent of the equity risked per trade (1 = 1 %) */
  riskPct: number;
  maxLeverage: number;
  makerBps: number;
  takerBps: number;
  slippage: SlippageModel;
  funding: "history" | "flat" | "none";
}

export interface PineOptions {
  /** Binance symbol (`BTCUSDT`) – only used for the comment and the file name */
  symbol?: string;
  /** the app's MCB / signal setting (WaveTrend parameters for the WaveTrend block) */
  signal?: SignalCfg;
  engine?: PineEngine;
  /** tick size of the market and a reference price: only then the lab's slippage becomes TradingView ticks */
  tick?: number;
  refPrice?: number;
  /** printed in the header (e.g. a date); omitted = nothing printed, so the text stays deterministic */
  stamp?: string;
}

export interface PineGap {
  /** leaf id (`n3`) */
  id: string;
  side: "long" | "short";
  block: BlockId;
  label: string;
  /** the condition in plain German as the builder shows it */
  text: string;
  reason: string;
}

export interface PineResult {
  code: string;
  fileName: string;
  /** blocks that could not be translated, by name */
  gaps: PineGap[];
  /** what will differ from the lab run, one sentence each */
  notes: string[];
  /** leaves of the active sides: translated / all */
  translated: number;
  total: number;
}

export const DEFAULT_PINE_ENGINE: PineEngine = { capital: 10_000, riskPct: 1, maxLeverage: 5, makerBps: 2, takerBps: 5, slippage: { kind: "fixed", bps: 2 }, funding: "history" };

// ── small formatting helpers ──────────────────────────────────────────────────────────────────────────────────

const q = (s: string): string => `"${s.replace(/"/g, "'").replace(/\\/g, "/")}"`;
const num = (p: LeafParams, k: string): number => Number(p[k]);
const str = (p: LeafParams, k: string): string => String(p[k]);
const fl = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(Math.round(v * 1e6) / 1e6));
const de = (v: number): string => String(Math.round(v * 10_000) / 10_000).replace(".", ",");
const slug = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "Idee";

/** TradingView resolution string of a lab timeframe. */
export const PINE_TF: Readonly<Record<TfId, string>> = { "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "1d": "1D" };

// ── translation of the blocks ─────────────────────────────────────────────────────────────────────────────────

/** What a block translator can use while it writes the body of its Pine function. */
interface LeafCtx {
  /** Pine variable of a numeric parameter (declared as an `input` at the top, so the trader can change it) */
  n(key: string): string;
  /** the app's MCB setting */
  sig: SignalCfg;
  /** seconds of one bar of the leaf's timeframe */
  tfSec: number;
}

type Translator = (p: LeafParams, c: LeafCtx) => string[];

/** `a` relative to `b`: state or crossing (with "within the last n bars"). */
function rel(a: string, b: string, mode: string, within: string): string {
  switch (mode) {
    case "above":
      return `${a} > ${b}`;
    case "below":
      return `${a} < ${b}`;
    case "crossUp":
      return `f_within(ta.crossover(${a}, ${b}), ${within})`;
    default:
      return `f_within(ta.crossunder(${a}, ${b}), ${within})`;
  }
}

const withinOf = (p: LeafParams, c: LeafCtx): string => (p.within !== undefined ? c.n("within") : "1");

const T: Partial<Record<BlockId, Translator>> = {
  rsi: (p, c) => [`float r = ta.rsi(close, ${c.n("len")})`, `bool res = ${rel("r", c.n("level"), str(p, "mode"), withinOf(p, c))}`],
  rsiMa: (p, c) => [`float r = ta.rsi(close, ${c.n("len")})`, `float m = ta.sma(r, ${c.n("maLen")})`, `bool res = ${rel("r", "m", str(p, "mode"), withinOf(p, c))}`],
  wtState: (p, c) => {
    const mode = str(p, "mode");
    const cond = mode === "wt1AboveWt2" ? "wt1 > wt2" : mode === "wt1BelowWt2" ? "wt1 < wt2" : `wt1 ${mode === "below" ? "<" : ">"} ${c.n("level")}`;
    return [
      `// WaveTrend (LazyBear / MCB) mit deinen Einstellungen: Kanal ${c.sig.wtChannel}, Durchschnitt ${c.sig.wtAverage}, Signal ${c.sig.wtSignal}`,
      `float ap = ${c.sig.wtSource === "hlc3" ? "hlc3" : "close"}`,
      `float esa = ta.ema(ap, ${c.sig.wtChannel})`,
      `float de = ta.ema(math.abs(ap - esa), ${c.sig.wtChannel})`,
      `float ci = de == 0 ? 0.0 : (ap - esa) / (0.015 * de)`,
      `float wt1 = ta.ema(ci, ${c.sig.wtAverage})`,
      `float wt2 = ta.sma(wt1, ${c.sig.wtSignal})`,
      `bool res = ${cond}`,
    ];
  },
  maCross: (p, c) => {
    const f = str(p, "type") === "sma" ? "ta.sma" : "ta.ema";
    return [`float fastMa = ${f}(close, ${c.n("fast")})`, `float slowMa = ${f}(close, ${c.n("slow")})`, `bool res = ${rel("fastMa", "slowMa", str(p, "mode") === "up" ? "crossUp" : "crossDown", c.n("within"))}`];
  },
  maPrice: (p, c) => [`float ma = ${str(p, "type") === "sma" ? "ta.sma" : "ta.ema"}(close, ${c.n("len")})`, `bool res = ${rel("close", "ma", str(p, "mode"), withinOf(p, c))}`],
  macd: (p, c) => {
    const mode = str(p, "mode");
    const w = withinOf(p, c);
    const cond: Record<string, string> = {
      crossUp: `f_within(ta.crossover(m, s), ${w})`,
      crossDown: `f_within(ta.crossunder(m, s), ${w})`,
      zeroUp: `f_within(ta.crossover(m, 0.0), ${w})`,
      zeroDown: `f_within(ta.crossunder(m, 0.0), ${w})`,
      aboveZero: "m > 0",
      belowZero: "m < 0",
      histPos: "h > 0",
      histNeg: "h < 0",
      histRising: "h > h[1]",
      histFalling: "h < h[1]",
    };
    return [`[m, s, h] = ta.macd(close, ${c.n("fast")}, ${c.n("slow")}, ${c.n("signal")})`, `bool res = ${cond[mode]}`];
  },
  bollinger: (p, c) => {
    const mode = str(p, "mode");
    const w = withinOf(p, c);
    const head = [`[mid, up, lo] = ta.bb(close, ${c.n("len")}, ${c.n("mult")})`];
    if (mode === "squeeze") return [...head, "float width = (up - lo) / math.abs(mid)", `bool sq = f_prank(width, ${c.n("lookback")}) <= ${c.n("pct")}`, `bool res = f_within(sq, ${w})`];
    const cond: Record<string, string> = {
      touchLower: "low <= lo",
      touchUpper: "high >= up",
      closeBelow: "close < lo",
      closeAbove: "close > up",
      backInLower: "close[1] < lo[1] and close >= lo",
      backInUpper: "close[1] > up[1] and close <= up",
      midUp: "close[1] <= mid[1] and close > mid",
      midDown: "close[1] >= mid[1] and close < mid",
    };
    return [...head, `bool ev = ${cond[mode]}`, `bool res = f_within(ev, ${w})`];
  },
  atrPct: (p, c) => [`float a = ta.atr(${c.n("len")})`, `float rank = f_prank(a, ${c.n("lookback")})`, `bool res = rank ${str(p, "mode") === "above" ? ">=" : "<="} ${c.n("pct")}`],
  breakout: (p, c) => {
    const up = str(p, "mode") === "up";
    return [up ? `float ext = ta.highest(high, ${c.n("n")})[1]` : `float ext = ta.lowest(low, ${c.n("n")})[1]`, `bool ev = ${up ? "close > ext" : "close < ext"}`, `bool res = f_within(ev, ${c.n("within")})`];
  },
  keyLevel: (p, c) => {
    const mode = str(p, "mode");
    const lv = c.n("level");
    const w = withinOf(p, c);
    const tol = `${c.n("tol")} / 100`;
    const cond: Record<string, string> = {
      touch: `high >= ${lv} and low <= ${lv}`,
      closeAbove: `close > ${lv}`,
      closeBelow: `close < ${lv}`,
      crossAbove: `f_within(close[1] <= ${lv} and close > ${lv}, ${w})`,
      crossBelow: `f_within(close[1] >= ${lv} and close < ${lv}, ${w})`,
      nAbove: `ta.lowest(close, ${c.n("n")}) > ${lv}`,
      nBelow: `ta.highest(close, ${c.n("n")}) < ${lv}`,
      retestUp: `close > ${lv} and low <= ${lv} * (1 + ${tol}) and priorHigh > ${lv}`,
      retestDown: `close < ${lv} and high >= ${lv} * (1 - ${tol}) and priorLow < ${lv}`,
    };
    // every call of ta.* sits on its own line so that it runs on every bar (`and` / `or` only evaluate what they need)
    if (mode === "retestUp") return [`float priorHigh = ta.highest(close, ${c.n("lookback")})[1]`, `bool res = ${cond[mode]}`];
    if (mode === "retestDown") return [`float priorLow = ta.lowest(close, ${c.n("lookback")})[1]`, `bool res = ${cond[mode]}`];
    return [`bool res = ${cond[mode]}`];
  },
  volume: (p, c) => {
    const candle = str(p, "candle");
    return [`float avgVol = ta.sma(volume, ${c.n("len")})[1]`, `bool ev = volume > ${c.n("mult")} * avgVol${candle === "bull" ? " and close > open" : candle === "bear" ? " and close < open" : ""}`, `bool res = f_within(ev, ${c.n("within")})`];
  },
  timeWindow: (p) => {
    const wd = str(p, "weekday");
    const se = str(p, "session");
    const day: Record<string, string> = { mon: "monday", tue: "tuesday", wed: "wednesday", thu: "thursday", fri: "friday", sat: "saturday", sun: "sunday" };
    const lines = ['int hr = hour(time, "UTC")', 'int dw = dayofweek(time, "UTC")', "bool weekend = dw == dayofweek.saturday or dw == dayofweek.sunday"];
    const parts: string[] = [];
    if (wd !== "any") parts.push(`dw == dayofweek.${day[wd]}`);
    if (se === "asia") parts.push("not weekend and hr < 7");
    if (se === "london") parts.push("not weekend and hr >= 7 and hr < 13");
    if (se === "ny") parts.push("not weekend and hr >= 13 and hr < 21");
    if (se === "late") parts.push("not weekend and hr >= 21");
    if (se === "weekend") parts.push("weekend");
    return [...lines, `bool res = ${parts.length ? parts.join(" and ") : "true"}`];
  },
  donchian: (p, c) => {
    const mode = str(p, "mode");
    const len = c.n("len");
    if (mode === "aboveMid" || mode === "belowMid") return [`float mid = (ta.highest(high, ${len}) + ta.lowest(low, ${len})) / 2`, `bool res = close ${mode === "aboveMid" ? ">" : "<"} mid`];
    const wick = str(p, "basis") === "wick";
    const up = mode === "breakUp";
    return [up ? `float ext = ta.highest(high, ${len})[1]` : `float ext = ta.lowest(low, ${len})[1]`, `bool ev = ${up ? (wick ? "high" : "close") : wick ? "low" : "close"} ${up ? ">" : "<"} ext`, `bool res = f_within(ev, ${c.n("within")})`];
  },
  adx: (p, c) => {
    const mode = str(p, "mode");
    const lv = /adx|trend/.test(mode) ? c.n("level") : "0";
    const cond: Record<string, string> = {
      adxAbove: `adx > ${lv}`,
      adxBelow: `adx < ${lv}`,
      trendUp: `adx > ${lv} and dip > dim`,
      trendDown: `adx > ${lv} and dim > dip`,
      diUp: `f_within(ta.crossover(dip, dim), ${withinOf(p, c)})`,
      diDown: `f_within(ta.crossunder(dip, dim), ${withinOf(p, c)})`,
    };
    return [`[dip, dim, adx] = ta.dmi(${c.n("len")}, ${c.n("smooth")})`, `bool res = ${cond[mode]}`];
  },
  stoch: (p, c) => {
    const mode = str(p, "mode");
    const lines = [`float k = ta.sma(ta.stoch(close, high, low, ${c.n("kLen")}), ${c.n("kSmooth")})`, `float d = ta.sma(k, ${c.n("dSmooth")})`];
    if (mode === "kdUp" || mode === "kdDown") {
      const up = mode === "kdUp";
      const extreme = str(p, "zone") === "extreme" ? (up ? ` and k[1] < ${c.n("level")} and d[1] < ${c.n("level")}` : ` and k[1] > 100 - ${c.n("level")} and d[1] > 100 - ${c.n("level")}`) : "";
      return [...lines, `bool ev = ${up ? "ta.crossover(k, d)" : "ta.crossunder(k, d)"}${extreme}`, `bool res = f_within(ev, ${c.n("within")})`];
    }
    return [...lines, `bool res = ${rel("k", c.n("level"), mode, withinOf(p, c))}`];
  },
  keltner: (p, c) => {
    const mode = str(p, "mode");
    const w = c.n("within");
    const head = [`float mid = ta.ema(close, ${c.n("len")})`, `float a = ta.atr(${c.n("atrLen")})`, `float up = mid + ${c.n("mult")} * a`, `float lo = mid - ${c.n("mult")} * a`];
    if (mode === "squeeze") return [...head, `[bbMid, bbUp, bbLo] = ta.bb(close, ${c.n("len")}, ${c.n("bbMult")})`, "bool sq = bbUp < up and bbLo > lo", `bool res = f_within(sq, ${w})`];
    const cond: Record<string, string> = {
      closeBelow: "close < lo",
      closeAbove: "close > up",
      touchLower: "low <= lo",
      touchUpper: "high >= up",
      backInLower: "close[1] < lo[1] and close >= lo",
      backInUpper: "close[1] > up[1] and close <= up",
    };
    return [...head, `bool ev = ${cond[mode]}`, `bool res = f_within(ev, ${w})`];
  },
  ichimoku: (p, c) => {
    const mode = str(p, "mode");
    const w = withinOf(p, c);
    const head = [
      `float tenkan = math.avg(ta.highest(high, ${c.n("conv")}), ta.lowest(low, ${c.n("conv")}))`,
      `float kijun = math.avg(ta.highest(high, ${c.n("base")}), ta.lowest(low, ${c.n("base")}))`,
      `float spanA = math.avg(tenkan, kijun)`,
      `float spanB = math.avg(ta.highest(high, ${c.n("spanB")}), ta.lowest(low, ${c.n("spanB")}))`,
      `// die Wolke in dieser Kerze: Werte von vor (Verschiebung − 1) Kerzen, wie der Indikator von TradingView`,
      `float cloudA = spanA[${c.n("shift")} - 1]`,
      `float cloudB = spanB[${c.n("shift")} - 1]`,
      "float top = math.max(cloudA, cloudB)",
      "float bot = math.min(cloudA, cloudB)",
    ];
    const cond: Record<string, string> = {
      aboveCloud: "close > top",
      belowCloud: "close < bot",
      inCloud: "close <= top and close >= bot",
      breakUp: `f_within(close > top and close[1] <= top[1], ${w})`,
      breakDown: `f_within(close < bot and close[1] >= bot[1], ${w})`,
      tkUp: `f_within(ta.crossover(tenkan, kijun), ${w})`,
      tkDown: `f_within(ta.crossunder(tenkan, kijun), ${w})`,
      greenCloud: "cloudA > cloudB",
      redCloud: "cloudA < cloudB",
    };
    return [...head, `bool res = ${cond[mode]}`];
  },
  cci: (p, c) => [`float v = ta.cci(hlc3, ${c.n("len")})`, `bool res = ${rel("v", c.n("level"), str(p, "mode"), withinOf(p, c))}`],
  willr: (p, c) => [`float v = ta.wpr(${c.n("len")})`, `bool res = ${rel("v", c.n("level"), str(p, "mode"), withinOf(p, c))}`],
  obv: (p, c) => {
    const mode = str(p, "mode");
    if (mode === "newHigh" || mode === "newLow") {
      const up = mode === "newHigh";
      return ["float o = ta.obv", `float ext = ${up ? "ta.highest" : "ta.lowest"}(o, ${c.n("n")})[1]`, `bool ev = o ${up ? ">" : "<"} ext`, `bool res = f_within(ev, ${c.n("within")})`];
    }
    return ["float o = ta.obv", `float m = ta.sma(o, ${c.n("len")})`, `bool res = ${rel("o", "m", mode, withinOf(p, c))}`];
  },
  vwap: (p, c) => {
    const anchor = str(p, "anchor");
    const mode = str(p, "mode");
    const key =
      anchor === "week"
        ? "int key = math.floor((time / 1000 - 4 * 86400) / (7 * 86400))"
        : anchor === "session"
          ? 'int key = math.floor(time / 86400000) * 8 + f_session(hour(time, "UTC"), dayofweek(time, "UTC"))'
          : "int key = math.floor(time / 86400000)";
    const lines = [key, "var float cumPV = 0.0", "var float cumV = 0.0", "if key != key[1]", "    cumPV := 0.0", "    cumV := 0.0", "cumPV += hlc3 * volume", "cumV += volume", "float vw = cumV > 0 ? cumPV / cumV : na"];
    if (mode === "belowBy") return [...lines, `bool res = close <= vw * (1 - ${c.n("dist")} / 100)`];
    if (mode === "aboveBy") return [...lines, `bool res = close >= vw * (1 + ${c.n("dist")} / 100)`];
    return [...lines, `bool res = ${rel("close", "vw", mode, withinOf(p, c))}`];
  },
  orb: (p, c) => {
    const start = { asia: 0, london: 7, ny: 13 }[str(p, "session") as "asia"] * 3600;
    const mode = str(p, "mode");
    const hit = mode === "up" ? "close > hi" : mode === "down" ? "close < lo" : "close <= hi and close >= lo";
    const first = str(p, "first") === "first" && mode !== "inside";
    return [
      `// Spanne: die ersten ${num(p, "minutes")} Minuten ab ${start / 3600}:00 UTC; gilt ${num(p, "validHours")} Stunden nach ihrem Ende`,
      'int sod = hour(time, "UTC") * 3600 + minute(time, "UTC") * 60',
      "int dkey = math.floor(time / 86400000)",
      "int barSec = timeframe.in_seconds()",
      `int rangeEnd = ${start} + ${c.n("minutes")} * 60`,
      "var float hi = na",
      "var float lo = na",
      "var int cnt = 0",
      "var int firedDay = -1",
      "if dkey != dkey[1]",
      "    hi := na",
      "    lo := na",
      "    cnt := 0",
      `if sod >= ${start} and sod + barSec <= rangeEnd`,
      "    hi := na(hi) ? high : math.max(hi, high)",
      "    lo := na(lo) ? low : math.min(lo, low)",
      "    cnt += 1",
      `bool valid = sod >= rangeEnd and sod < rangeEnd + ${c.n("validHours")} * 3600 and cnt >= math.round(${c.n("minutes")} * 60 / barSec)`,
      `bool hit = valid and ${hit}`,
      ...(first ? ["bool res = hit and firedDay != dkey", "if hit", "    firedDay := dkey"] : ["bool res = hit"]),
    ];
  },
  insideBar: (p, c) => {
    const mode = str(p, "mode");
    if (mode === "inside") return ["bool res = high < high[1] and low > low[1]"];
    return ["bool wasInside = high[1] < high[2] and low[1] > low[2]", `bool ev = wasInside and close ${mode === "breakUp" ? "> high[2]" : "< low[2]"}`, `bool res = f_within(ev, ${c.n("within")})`];
  },
  heikin: (p, c) => {
    const mode = str(p, "mode");
    const head = [
      "float haC = (open + high + low + close) / 4",
      "var float haO = na",
      "haO := na(haO[1]) ? (open + close) / 2 : (haO[1] + haC[1]) / 2",
      "float haH = math.max(high, haO, haC)",
      "float haL = math.min(low, haO, haC)",
    ];
    const n = mode.startsWith("flip") ? "1" : c.n("n");
    const cond: Record<string, string> = {
      bull: `ta.lowest(haC - haO, ${n}) > 0`,
      bear: `ta.highest(haC - haO, ${n}) < 0`,
      strongBull: `ta.lowest(haC - haO, ${n}) > 0 and haL >= haO - math.abs(haC) * 1e-9`,
      strongBear: `ta.highest(haC - haO, ${n}) < 0 and haH <= haO + math.abs(haC) * 1e-9`,
      flipUp: `f_within(haC > haO and not (haC[1] > haO[1]), ${c.n("within")})`,
      flipDown: `f_within(haC < haO and not (haC[1] < haO[1]), ${c.n("within")})`,
    };
    return [...head, `bool res = ${cond[mode]}`];
  },
  pivotBreak: (p, c) => {
    const up = str(p, "mode") === "up";
    const fn = up ? "ta.pivothigh(high" : "ta.pivotlow(low";
    return [`float pv = ${fn}, ${c.n("left")}, ${c.n("right")})`, "var float lvl = na", "if not na(pv)", "    lvl := pv", `bool ev = ${up ? "close > lvl and not (close[1] > lvl)" : "close < lvl and not (close[1] < lvl)"}`, `bool res = f_within(ev, ${c.n("within")})`];
  },
  fib: (p, c) => {
    const long = str(p, "dir") === "long";
    const touch = str(p, "basis") === "touch";
    const lo = long ? `swH - ${c.n("to")} * rng` : `swL + ${c.n("from")} * rng`;
    const hi = long ? `swH - ${c.n("from")} * rng` : `swL + ${c.n("to")} * rng`;
    return [
      `float ph = ta.pivothigh(high, ${c.n("len")}, ${c.n("len")})`,
      `float pl = ta.pivotlow(low, ${c.n("len")}, ${c.n("len")})`,
      "var float swH = na",
      "var float swL = na",
      "var int swHBar = na",
      "var int swLBar = na",
      "if not na(ph)",
      "    swH := ph",
      `    swHBar := bar_index - ${c.n("len")}`,
      "if not na(pl)",
      "    swL := pl",
      `    swLBar := bar_index - ${c.n("len")}`,
      "bool known = not na(swH) and not na(swL) and swH > swL",
      "bool upLeg = swLBar < swHBar",
      "float rng = swH - swL",
      `float zoneLo = ${lo}`,
      `float zoneHi = ${hi}`,
      `bool inZone = ${touch ? "low <= zoneHi and high >= zoneLo" : "close >= zoneLo and close <= zoneHi"}`,
      `bool res = known and ${long ? "upLeg" : "not upLeg"} and inZone`,
    ];
  },
  supertrend: (p, c) => {
    const mode = str(p, "mode");
    const w = withinOf(p, c);
    const cond: Record<string, string> = { up: "dir < 0", down: "dir > 0", flipUp: `f_within(dir < 0 and dir[1] > 0, ${w})`, flipDown: `f_within(dir > 0 and dir[1] < 0, ${w})` };
    return [`[st, dir] = ta.supertrend(${c.n("factor")}, ${c.n("atrLen")})`, "// Pine: dir < 0 = Aufwärtstrend", `bool res = ${cond[mode]}`];
  },
  chandelier: (p, c) => {
    const mode = str(p, "mode");
    const w = withinOf(p, c);
    const cond: Record<string, string> = { up: "dir == 1", down: "dir == -1", flipUp: `f_within(dir == 1 and dir[1] == -1, ${w})`, flipDown: `f_within(dir == -1 and dir[1] == 1, ${w})` };
    return [
      `float a = ta.atr(${c.n("len")})`,
      `float rawL = ta.highest(high, ${c.n("len")}) - ${c.n("mult")} * a`,
      `float rawS = ta.lowest(low, ${c.n("len")}) + ${c.n("mult")} * a`,
      "var float lStop = na",
      "var float sStop = na",
      "float prevL = na(lStop[1]) ? rawL : lStop[1]",
      "float prevS = na(sStop[1]) ? rawS : sStop[1]",
      "lStop := close[1] > prevL ? math.max(rawL, prevL) : rawL",
      "sStop := close[1] < prevS ? math.min(rawS, prevS) : rawS",
      "var int dir = 1",
      "dir := close > prevS ? 1 : close < prevL ? -1 : dir",
      `bool res = ${cond[mode]}`,
    ];
  },
};

/** Why a block has no translation (the blocks without an entry in `T`). */
const WHY: Partial<Record<BlockId, string>> = {
  wtEvent: "Die MCB-Punkte (Bottom, Top, Kauf, Verkauf) hängen an der Signal-Logik dieser App und sind nicht als einzelne Pine-Funktion nachgebaut.",
  mcbLadder: "Die MCB-Leiter prüft mehrere Zeitebenen gemeinsam nach den Regeln deines Einstiegs-Checks; das lässt sich nicht als kurzer Pine-Baustein ausdrücken.",
  zone: "Premium / Discount nutzt die Swing-Struktur von LuxAlgo; sie ist nicht als eigener Pine-Baustein nachgebaut.",
  rsiLine: "Die RSI-Trendlinie wird mit dem Linienfinder dieser App gesucht (Pivots, Ausbruch, Alter); er ist nicht nach Pine übertragen.",
  funding: "Pine kennt keine Funding-Historie der Börse; der Baustein kann dort nicht rechnen.",
};

export const pineSupports = (block: BlockId): boolean => block in T;

/** Input declaration of one numeric parameter. */
function inputLine(name: string, def: ParamDef, value: number, title: string, group: string): string {
  const parts = [def.kind === "int" ? String(Math.round(value)) : fl(value), q(title)];
  if (def.min != null) parts.push(`minval = ${def.kind === "int" ? def.min : fl(def.min)}`);
  if (def.max != null) parts.push(`maxval = ${def.kind === "int" ? def.max : fl(def.max)}`);
  if (def.kind === "float" && def.step != null) parts.push(`step = ${fl(def.step)}`);
  parts.push(`group = ${q(group)}`);
  return `${def.kind === "int" ? "int" : "float"} ${name} = input.${def.kind === "int" ? "int" : "float"}(${parts.join(", ")})`;
}

interface Built {
  /** `input` lines of the leaf */
  inputs: string[];
  /** the function that evaluates the leaf on its own timeframe (null = untranslated) */
  fn: string[] | null;
  /** the assignment of the leaf's boolean on the chart timeframe */
  use: string;
}

function buildLeaf(l: Leaf, side: "long" | "short", cfg: CustomConfig, sig: SignalCfg): Built {
  const def = BLOCKS[l.block];
  const tr = T[l.block];
  const group = `${side === "long" ? "Long" : "Short"} · ${def.label}`;
  const v = (k: string): string => `${l.id}_${k}`;
  if (!tr) {
    const name = `allow_${l.id}`;
    return { inputs: [`bool ${name} = input.bool(false, ${q(`${l.id} · NICHT ÜBERSETZT: ${nodeText(l, false)} – als erfüllt annehmen`)}, group = "NICHT übersetzte Bausteine")`], fn: null, use: `bool ${l.id} = ${name}` };
  }
  const tfId: TfId = l.tf === "exec" ? cfg.interval : l.tf;
  // every numeric parameter the body mentions becomes an input (declared once, only when it is really used)
  const declared = new Map<string, string>();
  const ctx: LeafCtx = {
    sig,
    tfSec: TF_SEC[tfId],
    n(key: string): string {
      const pd = def.params.find((d) => d.key === key);
      if (!pd || pd.kind === "select") throw new Error(`pine: ${l.block}.${key} is not numeric`);
      if (!declared.has(key)) declared.set(key, inputLine(v(key), pd, num(l.params, key), `${l.id} · ${pd.label}${pd.unit ? ` (${pd.unit})` : ""}`, group));
      return v(key);
    },
  };
  const body = tr(l.params, ctx);
  const inputs = [...declared.entries()].filter(([key]) => body.some((line) => new RegExp(`\\b${v(key)}\\b`).test(line))).map(([, line]) => line);
  const warm = def.warmup(l.params);
  const w = Math.max(0, Math.round(warm));
  const last = w > 0 ? `bar_index < ${w} ? false : ${l.not ? "not res" : "res"}` : l.not ? "not res" : "res";
  const fn = [`f_${l.id}() =>`, ...body.map((b) => `    ${b}`), `    ${last}`];
  const call = l.tf === "exec" || l.tf === cfg.interval ? `f_${l.id}()` : `request.security(syminfo.tickerid, ${q(PINE_TF[l.tf])}, f_${l.id}(), lookahead = barmerge.lookahead_off)`;
  return { inputs, fn, use: `bool ${l.id} = ${call}` };
}

/** `(a and b) or c` as Pine boolean expression of a tree; groups become named booleans so the lines stay short. */
function treeLines(g: Group, lines: string[], name: string): string {
  const parts: string[] = g.children.map((c: Node) => {
    if (c.type === "leaf") return c.id;
    return treeLines(c, lines, `${name}_${c.id}`);
  });
  const expr = parts.length ? parts.join(g.op === "and" ? " and " : " or ") : "false";
  lines.push(`bool ${name} = ${expr}`);
  return name;
}

// ── the script ────────────────────────────────────────────────────────────────────────────────────────────────

const HEAD_NOTES = [
  "Kerzen: Das Labor rechnet auf Binance-USDⓈ-M-Kerzen, TradingView auf dem Feed des gewählten Symbols. Schon kleine Unterschiede in Hoch, Tief oder Volumen verschieben einzelne Signale.",
  "Gebühren: Das Labor zahlt für Ziele (Limit) die Maker-Gebühr und für alles andere die Taker-Gebühr. Das Skript setzt EINE Gebühr (Taker) für jeden Fill.",
  "Slippage: TradingView kennt sie nur in Ticks. Das Labor rechnet je Market- und Stop-Fill, nie bei Zielen.",
  "Reihenfolge in einer Kerze: Liegen Stop und Ziel in derselben Kerze, nimmt das Labor den Stop (vorsichtig). TradingView simuliert einen Weg durch die Kerze und kann das Ziel zuerst treffen.",
  "Lücken: Liegt die Eröffnung der Folgekerze schon hinter Stop oder Ziel, überspringt das Labor das Signal. Das Skript steigt trotzdem ein.",
  "Verwaltung (Break-even, Trailing, Teil-Gewinn, Zeit-Stop): Das Labor entscheidet zum Kerzenschluss und wirkt ab der nächsten Kerze; das Skript tut dasselbe, der Zeit-Stop läuft aber zur nächsten Eröffnung.",
  "Höhere Zeitebenen: nur geschlossene Kerzen (request.security ohne lookahead).",
];

function slipTicks(e: PineEngine, o: PineOptions): { ticks: number; note: string } {
  const s = e.slippage;
  if (s.kind === "none") return { ticks: 0, note: "Slippage: im Lauf keine." };
  if (s.kind === "atr") return { ticks: 0, note: `Slippage: im Lauf ${Math.round(s.frac * 100)} % der ATR je Fill – das lässt sich nicht in feste Ticks fassen; im Skript steht 0. Stelle sie bei Bedarf unter Einstellungen → Eigenschaften → Slippage ein.` };
  const bps = s.kind === "fixed" ? s.bps : s.bps / 2;
  if (o.tick && o.refPrice && o.tick > 0 && o.refPrice > 0) {
    const t = Math.max(0, Math.round((o.refPrice * (bps / 10_000)) / o.tick));
    return { ticks: t, note: `Slippage: im Lauf ${de(bps)} bp je Fill ≈ ${t} Ticks bei Kurs ${de(o.refPrice)} und Tick ${de(o.tick)}.` };
  }
  return { ticks: 0, note: `Slippage: im Lauf ${de(bps)} bp je Fill. Die Tick-Größe des Marktes ist der App nicht bekannt, deshalb steht im Skript 0 – rechne ${de(bps)} bp deines Kurses in Ticks um und trage sie unter Einstellungen → Eigenschaften → Slippage ein.` };
}

export function toPine(config: CustomConfig, options: PineOptions = {}): PineResult {
  const sig = options.signal ?? DEFAULT_SIGNAL_CFG;
  const eng = options.engine ?? DEFAULT_PINE_ENGINE;
  const sides = sidesOf(config);
  const leaves = activeLeaves(config);
  const gaps: PineGap[] = [];
  const notes: string[] = [];

  // build every leaf once (ids are unique across both sides)
  const built = new Map<string, Built>();
  for (const side of sides) {
    for (const l of leavesOf(config[side])) {
      const b = buildLeaf(l, side, config, sig);
      built.set(l.id, b);
      if (!b.fn) gaps.push({ id: l.id, side, block: l.block, label: BLOCKS[l.block].label, text: nodeText(l, false), reason: WHY[l.block] ?? "Dieser Baustein ist nicht nach Pine übertragbar." });
    }
  }
  const slip = slipTicks(eng, options);
  notes.push(...HEAD_NOTES);
  notes.push(slip.note);
  notes.push(eng.funding === "none" ? "Funding: im Lauf keines – passt." : `Funding: im Lauf ${eng.funding === "history" ? "die echte Historie der Börse" : "ein fester Satz je 8 Stunden"}; TradingView rechnet kein Funding.`);
  if (gaps.length) notes.push(`${gaps.length} Baustein${gaps.length === 1 ? "" : "e"} nicht übersetzt (${gaps.map((g) => `${g.label} ${g.id}`).join(", ")}): im Skript als Eingabe „als erfüllt annehmen“, Standard aus – bis du sie setzt, handelt das Skript nicht wie das Labor.`);

  const L: string[] = [];
  const add = (...s: string[]): void => void L.push(...s);
  const name = (config.name || "Eigene Idee").replace(/"/g, "'");

  add("//@version=6");
  add("// ════════════════════════════════════════════════════════════════════════════════");
  add(`// Trading-Journal · Labor → Pine${options.stamp ? ` · ${options.stamp}` : ""}`);
  add(`// Idee: ${name}${options.symbol ? ` · Markt im Labor: ${options.symbol}` : ""} · Ausführung ${TF_LABEL[config.interval]}`);
  add("//");
  add("// So liest sich die Idee:");
  for (const side of sides) add(`//   ${side === "long" ? "Long" : "Short"} wenn ${nodeText(config[side])}.`);
  add(`//   Stop: ${stopText(config.stop)}. ${exitsText(config).join(". ")}.`);
  add("//");
  add("// WICHTIG – lies das, bevor du Zahlen vergleichst:");
  add("//   Das ist ein Nachbau der Regeln, kein Beweis. Ergebnisse in TradingView weichen vom Labor ab, weil Kerzen,");
  add("//   Gebühren und Annahmen verschieden sind:");
  for (const n of notes.filter((x) => !x.includes("nicht übersetzt"))) add(`//   • ${n}`);
  if (gaps.length) {
    add("//");
    add("// NICHT ÜBERSETZT (nicht still weggelassen, sondern als Eingabe sichtbar, Standard: nicht erfüllt):");
    for (const g of gaps) add(`//   • ${g.id} (${g.side === "long" ? "Long" : "Short"}) ${g.label}: ${g.text} – ${g.reason}`);
  }
  add("//");
  add("// Zurück ins Labor: Strategietester → „Liste der Trades“ → als CSV exportieren und im Labor unter „TradingView“ laden.");
  add("// Die App kann Pine weder ausführen noch prüfen: meldet TradingView einen Fehler, steht er in Zeile und Text im Editor.");
  add("// ════════════════════════════════════════════════════════════════════════════════");
  add("");

  const takerPct = eng.takerBps / 100;
  add(
    `strategy(${q(name)}, overlay = true, initial_capital = ${fl(eng.capital)}, pyramiding = 0, calc_on_every_tick = false, process_orders_on_close = false, commission_type = strategy.commission.percent, commission_value = ${fl(Math.round(takerPct * 1e6) / 1e6)}, slippage = ${slip.ticks}, default_qty_type = strategy.fixed, default_qty_value = 1)`,
  );
  add("");

  // inputs
  add("// ── Einstellungen ───────────────────────────────────────────────────────────────");
  add(`float riskPct = input.float(${fl(eng.riskPct)}, "Risiko je Trade (% des Kontos)", minval = 0.05, maxval = 10, step = 0.05, group = "Größe")`);
  add(`float maxLev = input.float(${fl(eng.maxLeverage)}, "Maximaler Hebel (Positionswert / Konto)", minval = 1, maxval = 125, step = 1, group = "Größe")`);
  const st = config.stop;
  if (st.kind === "atr") add(`float stopAtr = input.float(${fl(st.atr)}, "Stop (× ATR 14)", minval = 0.3, maxval = 10, step = 0.1, group = "Stop und Ziel")`);
  if (st.kind === "percent") add(`float stopPct = input.float(${fl(st.pct)}, "Stop (% vom Schluss)", minval = 0.05, maxval = 30, step = 0.05, group = "Stop und Ziel")`);
  if (st.kind === "swing") {
    add(`int stopSwing = input.int(${st.swing}, "Stop: Swing über N Kerzen", minval = 2, maxval = 200, group = "Stop und Ziel")`);
    add(`float stopBuf = input.float(${fl(st.buffer)}, "Stop: Puffer (× ATR 14)", minval = 0, maxval = 3, step = 0.05, group = "Stop und Ziel")`);
  }
  if (config.target.kind === "r") add(`float targetR = input.float(${fl(config.target.r)}, "Ziel (Vielfaches des Risikos, R)", minval = 0.25, maxval = 20, step = 0.25, group = "Stop und Ziel")`);
  const ex = config.exits;
  if (ex.breakEven.on) {
    add(`float beVal = input.float(${fl(ex.breakEven.value)}, "Break-even nach ${ex.breakEven.trigger === "r" ? "R" : "%"}", minval = 0.1, step = 0.1, group = "Verwaltung")`);
  }
  if (ex.trail.on) {
    add(`float trailVal = input.float(${fl(ex.trail.value)}, "Trailing-Stop (${ex.trail.kind === "atr" ? "× ATR 14" : "%"})", minval = 0.2, step = 0.1, group = "Verwaltung")`);
    add(`float trailFromR = input.float(${fl(ex.trail.activateR)}, "Trailing ab R", minval = 0, step = 0.25, group = "Verwaltung")`);
  }
  if (ex.partial.on) {
    add(`float partAtR = input.float(${fl(ex.partial.atR)}, "Teil-Gewinn bei R", minval = 0.2, step = 0.1, group = "Verwaltung")`);
    add(`float partPct = input.float(${fl(ex.partial.fracPct)}, "Teil-Gewinn: Anteil %", minval = 5, maxval = 95, step = 5, group = "Verwaltung")`);
  }
  if (ex.maxBars > 0) add(`int maxBarsIn = input.int(${ex.maxBars}, "Zeit-Stop (Kerzen)", minval = 1, group = "Verwaltung")`);
  for (const side of sides) {
    for (const l of leavesOf(config[side])) for (const i of built.get(l.id)!.inputs) add(i);
  }
  add("");

  // helpers
  add("// ── Hilfsfunktionen ─────────────────────────────────────────────────────────────");
  add("// „innerhalb der letzten n Kerzen“ für Ereignisse");
  add("f_within(bool ev, int n) =>", "    int bs = ta.barssince(ev)", "    n <= 1 ? ev : (not na(bs) and bs < n)");
  const needsRank = leaves.some((l) => (l.block === "bollinger" && l.params.mode === "squeeze") || l.block === "atrPct");
  if (needsRank) {
    add("// Prozent-Rang wie im Labor: Anteil der ANDEREN Werte des Fensters, die kleiner sind");
    add("f_prank(float src, int len) =>", "    int lt = 0", "    for k = 1 to len - 1", "        if src[k] < src", "            lt += 1", "    lt / (len - 1.0) * 100");
  }
  if (leaves.some((l) => l.block === "vwap" && l.params.anchor === "session")) {
    add("// Session-Nummer wie im Labor (UTC): Asien < 07, London < 13, New York < 21, Spät; Sa / So = Wochenende");
    add("f_session(int hr, int dw) =>", "    (dw == dayofweek.saturday or dw == dayofweek.sunday) ? 4 : hr < 7 ? 0 : hr < 13 ? 1 : hr < 21 ? 2 : 3");
  }
  add("");

  // block functions
  add("// ── Bausteine (jeweils auf der Zeitebene des Bausteins, nur geschlossene Kerzen) ───");
  for (const side of sides) {
    for (const l of leavesOf(config[side])) {
      const b = built.get(l.id)!;
      add(`// ${l.id} · ${side === "long" ? "Long" : "Short"} · ${nodeText(l, false)}`);
      if (b.fn) add(...b.fn);
      else add(`// (nicht übersetzt – siehe Eingabe „allow_${l.id}“)`);
    }
  }
  add("");

  add("// ── Bedingungen auf dem Chart ───────────────────────────────────────────────────");
  for (const side of sides) for (const l of leavesOf(config[side])) add(built.get(l.id)!.use);
  const roots: Record<string, string> = {};
  for (const side of sides) roots[side] = treeLines(config[side], L, `${side}Hit`);
  add("");

  // signals
  add("// ── Signale: nur ein NEUES Signal zählt (die Bedingung war an der Kerze davor nicht erfüllt) ──");
  add("bool flat = strategy.position_size == 0");
  if (sides.includes("long")) add(`bool longEdge = ${roots.long} and not ${roots.long}[1]`);
  if (sides.includes("short")) add(`bool shortEdge = ${roots.short} and not ${roots.short}[1]`);
  const both = sides.length === 2;
  add("float atr14 = ta.atr(14)");
  if (st.kind === "swing") add("float swLow = ta.lowest(low, stopSwing)", "float swHigh = ta.highest(high, stopSwing)");
  add("");

  // sizing
  add("// ── Größe: Risiko % des Kontos zwischen Einstieg und Stop, gedeckelt durch den Hebel ──");
  add("f_qty(float entryPx, float stopPx) =>", "    float dist = math.abs(entryPx - stopPx)", "    float eq = strategy.equity", "    float risk = dist > 0 ? eq * riskPct / 100 / dist : 0.0", "    math.min(risk, eq * maxLev / entryPx)");
  add("");

  // state
  add("var float sigStop = na");
  add("var float sigTgt = na");
  add("var float curStop = na");
  add("var float stop0 = na");
  add("var float tgt = na");
  add("var float peak = na");
  add("var float posQty0 = na");
  add("var float partPx = na");
  add("var bool beDone = false");
  add("var bool partDone = false");
  add("");

  const stopExpr = (dir: 1 | -1): string => {
    if (st.kind === "atr") return `close ${dir === 1 ? "-" : "+"} stopAtr * atr14`;
    if (st.kind === "percent") return `close * (1 ${dir === 1 ? "-" : "+"} stopPct / 100)`;
    return dir === 1 ? "swLow - stopBuf * atr14" : "swHigh + stopBuf * atr14";
  };
  const entryBlock = (side: "long" | "short"): void => {
    const dir = side === "long" ? 1 : -1;
    const idn = side === "long" ? "Long" : "Short";
    const cond = both ? `${side}Edge and not ${side === "long" ? "shortEdge" : "longEdge"}` : `${side}Edge`;
    add(`if flat and ${cond}`);
    add(`    float stopPx = ${stopExpr(dir)}`);
    add(`    float dist = math.abs(close - stopPx)`);
    add(`    if ${dir === 1 ? "stopPx < close" : "stopPx > close"} and dist > close * 0.0005`);
    add(`        sigStop := stopPx`);
    add(`        sigTgt := ${config.target.kind === "r" ? `close ${dir === 1 ? "+" : "-"} dist * targetR` : "na"}`);
    add(`        float qty = f_qty(close, stopPx)`);
    add(`        if qty > 0`);
    add(`            strategy.entry(${q(idn)}, strategy.${side}, qty = qty, comment = ${q(`${config.name}`.slice(0, 40))})`);
    if (ex.partial.on) {
      add(`            float pPx = close ${dir === 1 ? "+" : "-"} dist * partAtR`);
      add(`            if na(sigTgt) or ${dir === 1 ? "pPx < sigTgt" : "pPx > sigTgt"}`);
      add(`                strategy.exit(${q(`${idn} P`)}, ${q(idn)}, qty_percent = partPct, limit = pPx, stop = sigStop)`);
    }
    add(`            strategy.exit(${q(`${idn} X`)}, ${q(idn)}, stop = sigStop, limit = sigTgt)`);
  };
  add("// ── Einstieg: bei Schluss der Signalkerze bestellt, gefüllt zur Eröffnung der nächsten ──");
  if (sides.includes("long")) entryBlock("long");
  if (sides.includes("short")) entryBlock("short");
  add("");

  // management
  add("// ── Verwaltung der offenen Position (zum Kerzenschluss entschieden, ab der nächsten Kerze wirksam) ──");
  add("bool newPos = strategy.position_size != 0 and strategy.position_size[1] == 0");
  add("if strategy.position_size != 0");
  add("    bool isLong = strategy.position_size > 0");
  add("    string idn = isLong ? \"Long\" : \"Short\"");
  add("    float entryPx = strategy.position_avg_price");
  add("    if newPos");
  add("        stop0 := sigStop");
  add("        curStop := sigStop");
  add("        tgt := sigTgt");
  add("        peak := entryPx");
  add("        posQty0 := math.abs(strategy.position_size)");
  add("        beDone := false");
  add("        partDone := false");
  add("    float risk0 = math.abs(entryPx - stop0)");
  add("    peak := isLong ? math.max(peak, high) : math.min(peak, low)");
  if (ex.partial.on) {
    add(`    partPx := isLong ? entryPx + partAtR * risk0 : entryPx - partAtR * risk0`);
    add(`    if not partDone and math.abs(strategy.position_size) < posQty0 * 0.999`);
    add(`        partDone := true`);
  }
  if (ex.breakEven.on) {
    const trig = ex.breakEven.trigger === "r" ? "isLong ? entryPx + beVal * risk0 : entryPx - beVal * risk0" : "entryPx * (1 + (isLong ? 1 : -1) * beVal / 100)";
    const lvl = ex.breakEven.to === "net" ? `entryPx * (1 + (isLong ? 1 : -1) * ${fl(Math.round(2 * (eng.takerBps / 10_000) * 1e6) / 1e6)})` : "entryPx";
    add(`    float beTrig = ${trig}`);
    add(`    float beLvl = ${lvl}${ex.breakEven.to === "net" ? " // Gebühren für Ein- und Ausstieg gedeckt (Näherung)" : ""}`);
    const gate = ex.partial.on && ex.partial.thenBreakEven ? "(isLong ? peak >= beTrig : peak <= beTrig) or partDone" : "(isLong ? peak >= beTrig : peak <= beTrig)";
    add(`    if not beDone and (${gate})`);
    add(`        if (isLong ? beLvl < close : beLvl > close)`);
    add(`            curStop := isLong ? math.max(curStop, beLvl) : math.min(curStop, beLvl)`);
    add(`            beDone := true`);
  } else if (ex.partial.on && ex.partial.thenBreakEven) {
    add(`    if not beDone and partDone`);
    add(`        float beLvl = entryPx`);
    add(`        if (isLong ? beLvl < close : beLvl > close)`);
    add(`            curStop := isLong ? math.max(curStop, beLvl) : math.min(curStop, beLvl)`);
    add(`            beDone := true`);
  }
  if (ex.trail.on) {
    add(`    bool armed = trailFromR <= 0 or (isLong ? peak >= entryPx + trailFromR * risk0 : peak <= entryPx - trailFromR * risk0)`);
    add(`    if armed`);
    add(`        float tdist = ${ex.trail.kind === "atr" ? "trailVal * atr14" : "peak * trailVal / 100"}`);
    add(`        if tdist > 0`);
    add(`            float tlvl = isLong ? peak - tdist : peak + tdist`);
    add(`            curStop := isLong ? math.max(curStop, tlvl) : math.min(curStop, tlvl)`);
  }
  if (ex.partial.on) {
    add(`    if not partDone and (na(tgt) or (isLong ? partPx < tgt : partPx > tgt))`);
    add(`        strategy.exit(idn + " P", idn, qty_percent = partPct, limit = partPx, stop = curStop)`);
  }
  add(`    strategy.exit(idn + " X", idn, stop = curStop, limit = tgt)`);
  if (ex.maxBars > 0) {
    add(`    if bar_index - strategy.opentrades.entry_bar_index(0) + 1 >= maxBarsIn`);
    add(`        strategy.close_all(comment = "Zeit-Stop")`);
  }
  if (ex.exitOnOpposite && both) {
    add(`    if isLong and shortEdge`);
    add(`        strategy.close("Long", comment = "Gegensignal")`);
    add(`    if not isLong and longEdge`);
    add(`        strategy.close("Short", comment = "Gegensignal")`);
  }
  add("");
  add("// ── Anzeige ─────────────────────────────────────────────────────────────────────");
  if (sides.includes("long")) add(`plotshape(flat and longEdge, "Long-Signal", shape.triangleup, location.belowbar, color.new(color.teal, 0), size = size.tiny)`);
  if (sides.includes("short")) add(`plotshape(flat and shortEdge, "Short-Signal", shape.triangledown, location.abovebar, color.new(color.red, 0), size = size.tiny)`);
  add("plot(strategy.position_size != 0 ? curStop : na, \"Stop\", color.new(color.orange, 20), style = plot.style_linebr)");

  return {
    code: `${L.join("\n")}\n`,
    fileName: `Eigene-Idee_${slug(config.name)}${options.symbol ? `_${options.symbol}` : ""}.pine`,
    gaps,
    notes,
    translated: leaves.length - gaps.length,
    total: leaves.length,
  };
}
