/**
 * Part (b): every earlier time the set-up would have fired, on the REAL candles (pure, deterministic, stepped).
 *
 * The plan's prices are put as a rule (`plan.ts` → `Relative`) and applied to the history in time order, one position at a
 * time (after an exit the search goes on from that candle):
 * - the decision is taken at a candle's close (`close`: the entry level sits `entryOffsetAtr` ATR from the close; `range`: at the
 *   plan's place inside the range of the last N candles; `level`: the plan's own price, fixed);
 * - `market` fills at the next open; a `limit` order (the price comes back to the level) and a `stop` order (it breaks through the
 *   level) fill inside a candle at the level – or at the open when the candle opened beyond it; they wait `validBars` candles
 *   (the `level` trigger waits for the price to come from the side it came from at plan time, as long as it takes);
 * - the trade then runs through the SAME engine as the simulation. Honest limits inside the entry candle: after a limit fill the
 *   target cannot be reached in that candle (the order of high and low is unknown), the stop can; a candle that holds both
 *   stop and target counts as the stop.
 * A trade that was still open when the data ended is counted apart (`openAtEnd`) and not used for any figure.
 */
import { atrSeries } from "../backtest/bars";
import type { Bar, BtStrategy, EngineCfg } from "../backtest/types";
import { engineCfg, excursionR, onceAtStart, playSegment, signalOf } from "./play";
import { rangeOf, RANGE_TOL, type OrderKind, type Relative } from "./plan";
import { meanOf, prob, quart } from "./stats";
import type { TmEvent, TmHistory, TmInput } from "./types";

const EPS = 1e-9;

export class HistoryJob {
  readonly events: TmEvent[] = [];
  openAtEnd = 0;
  unfilled = 0;
  skippedGap = 0;
  private i: number;
  private finished = false;
  private readonly bars: readonly Bar[];
  private readonly atr: number[];
  private readonly cfg: EngineCfg;
  private readonly n: number;
  private readonly H: number;
  private readonly secLen: number;
  private readonly strat: BtStrategy & { signal: ReturnType<typeof signalOf> };
  /** `level` trigger: which side of the level the price was on at plan time (+1 above, −1 below) */
  private readonly levelSide: 1 | -1;

  constructor(
    private readonly input: TmInput,
    bars: readonly Bar[],
    private readonly rel: Relative,
    secLen: number,
    atr?: number[],
  ) {
    this.bars = bars;
    this.n = bars.length;
    this.H = input.horizon;
    this.secLen = secLen;
    this.atr = atr ?? atrSeries(bars);
    this.cfg = engineCfg(input.costs);
    this.strat = onceAtStart(signalOf(input.plan, input.plan.stop, input.plan.target, input.horizon, input.manage));
    // warm-up: ATR(14) and the range need their candles
    const t = input.trigger;
    this.i = Math.max(15, t.kind === "range" ? t.lookback : 0);
    const diff = rel.last - input.plan.entry;
    this.levelSide = diff > 0 ? 1 : diff < 0 ? -1 : input.plan.side === "long" ? 1 : -1;
  }

  get progress(): number {
    return this.finished ? 1 : Math.min(1, this.i / Math.max(1, this.n));
  }

  step(deadline: number): boolean {
    let units = 0;
    while (!this.finished) {
      this.unit();
      units++;
      if ((units & 7) === 0 && performance.now() >= deadline) break;
    }
    return this.finished;
  }

  /** One decision: place an order (or wait for the level), find the fill, play the trade, move on. */
  private unit(): void {
    const { n, bars } = this;
    if (this.i >= n - 1) {
      this.finished = true;
      return;
    }
    const { plan, trigger, validBars } = this.input;
    const side = plan.side === "long" ? 1 : -1;
    const i = this.i;
    let level: number;
    let kind: OrderKind;
    let stop: number;
    let target: number;
    if (trigger.kind === "level") {
      level = plan.entry;
      stop = plan.stop;
      target = plan.target;
      kind = this.levelKind();
      const j = this.findLevelFill(i, level);
      if (j < 0) {
        this.finished = true;
        return;
      }
      this.fill(i, j, kind, level, stop, target);
      return;
    }
    const a = this.atr[i]!;
    if (!(a > 0)) {
      this.i++;
      return;
    }
    if (trigger.kind === "close") {
      level = bars[i]!.c + this.rel.entryOffsetAtr * a;
    } else if (this.rel.kind === "market") {
      // an entry "now" has no level to wait for: the SET-UP is that the close sits where it sits in the range today (± RANGE_TOL of the
      // range's height), and it fires the moment the close comes into that zone
      if (!(this.inZone(i) && !this.inZone(i - 1))) {
        this.i++;
        return;
      }
      level = bars[i]!.c;
    } else {
      const { lo, hi } = rangeOf(bars, i - trigger.lookback + 1, i);
      if (!(hi > lo)) {
        this.i++;
        return;
      }
      level = lo + (this.rel.rangePos ?? 0.5) * (hi - lo);
    }
    stop = level - side * this.rel.stopAtr * a;
    target = level + side * this.rel.targetAtr * a;
    if (!(stop > 0 && level > 0)) {
      this.i++;
      return;
    }
    kind = this.rel.kind;
    if (kind === "market") {
      this.fill(i, i + 1, "market", level, stop, target);
      return;
    }
    const last = Math.min(n - 1, i + validBars);
    const j = this.findWindowFill(i + 1, last, kind, level);
    if (j < 0) {
      if (i + validBars > n - 1) {
        // the window reaches past the data: an order that had no time to fill is not a miss
        this.finished = true;
        return;
      }
      this.unfilled++;
      this.i = last;
      return;
    }
    this.fill(i, j, kind, level, stop, target);
  }

  /** Does the close of candle `j` sit in the plan's zone of the range of the last N candles (range trigger, market entry)? */
  private inZone(j: number): boolean {
    const t = this.input.trigger;
    if (t.kind !== "range" || this.rel.rangePos == null || j < t.lookback) return false;
    const { lo, hi } = rangeOf(this.bars, j - t.lookback + 1, j);
    if (!(hi > lo)) return false;
    return Math.abs((this.bars[j]!.c - lo) / (hi - lo) - this.rel.rangePos) <= RANGE_TOL;
  }

  /** `limit` (long: buy below / short: sell above the price) or `stop` for the level trigger, from the side the price came from. */
  private levelKind(): OrderKind {
    const long = this.input.plan.side === "long";
    // price above the level: it comes down to it – a long buys the dip (limit), a short sells a break (stop)
    return this.levelSide === 1 ? (long ? "limit" : "stop") : long ? "stop" : "limit";
  }

  /** First candle j > i that touches the level coming from the plan's side (previous close on that side). */
  private findLevelFill(from: number, level: number): number {
    const { bars, n, levelSide } = this;
    for (let j = from + 1; j < n; j++) {
      const prev = bars[j - 1]!.c;
      const b = bars[j]!;
      if (levelSide === 1) {
        if (prev > level && b.l <= level) return j;
      } else if (prev < level && b.h >= level) return j;
    }
    return -1;
  }

  /** First candle in [from, to] in which the order fills (limit: the price reaches the level against the trade, stop: through it). */
  private findWindowFill(from: number, to: number, kind: OrderKind, level: number): number {
    const long = this.input.plan.side === "long";
    const { bars } = this;
    for (let j = from; j <= to; j++) {
      const b = bars[j]!;
      // limit long / stop short fill when the LOW reaches the level; stop long / limit short when the HIGH reaches it
      const downward = kind === "limit" ? long : !long;
      if (downward ? b.l <= level : b.h >= level) return j;
    }
    return -1;
  }

  /** Fill candle `j` of an order decided at the close of candle `i`: run the trade, record it, move on. */
  private fill(i: number, j: number, kind: OrderKind, level: number, stop: number, target: number): void {
    const { bars, n, H, secLen } = this;
    if (j > n - 1) {
      this.finished = true;
      return;
    }
    const long = this.input.plan.side === "long";
    this.strat.signal = signalOf(this.input.plan, stop, target, H, this.input.manage);
    let seg: Bar[];
    let atrSeg: number[];
    let fillIdx: number;
    if (kind === "market") {
      // the signal candle is the real candle i; the engine fills at the open of i + 1
      seg = bars.slice(i, i + H + 1) as Bar[];
      atrSeg = this.atr.slice(i, i + H + 1);
      fillIdx = i + 1;
    } else {
      const b = bars[j]!;
      // fill price: the level, or the open when the candle opened beyond it (better for limit, worse for stop)
      const f = (kind === "limit") === long ? Math.min(b.o, level) : Math.max(b.o, level);
      let h = b.h;
      let l = b.l;
      let c = b.c;
      if (kind === "limit") {
        // the order of high and low inside the candle is unknown: after a limit fill the target cannot count in this candle
        if (long) {
          h = Math.max(f, Math.min(h, target * (1 - EPS)));
          c = Math.min(c, h);
        } else {
          l = Math.min(f, Math.max(l, target * (1 + EPS)));
          c = Math.max(c, l);
        }
      }
      const stub: Bar = { t: b.t - secLen, o: f, h: f, l: f, c: f };
      const copy: Bar = { t: b.t, o: f, h: Math.max(h, f), l: Math.min(l, f), c };
      seg = [stub, copy, ...(bars.slice(j + 1, j + H) as Bar[])];
      atrSeg = [this.atr[j - 1] ?? this.atr[j]!, ...this.atr.slice(j, j + H)];
      fillIdx = j;
    }
    const played = playSegment(seg, atrSeg, this.strat, this.cfg, secLen);
    const t = played.trade;
    if (!t) {
      // the open lay beyond the stop or the target (or the stop was too close): the engine does not trade it
      this.skippedGap++;
      this.i = Math.max(this.i + 1, fillIdx);
      return;
    }
    const exitIdx = fillIdx + t.bars - 1;
    if (t.reason === "end") {
      // the data ended before the trade did
      this.openAtEnd++;
      this.finished = true;
      return;
    }
    const ex = excursionR(seg, t);
    this.events.push({
      i: fillIdx,
      entryT: t.entryTime,
      entry: t.entry,
      stop: t.stop,
      target,
      kind,
      exitT: t.exitTime,
      bars: t.bars,
      reason: t.reason,
      r: t.r,
      mae: ex.mae,
      mfe: ex.mfe,
      ambiguous: t.ambiguous === true,
    });
    this.i = Math.max(exitIdx, fillIdx);
  }

  result(): TmHistory {
    const ev = this.events;
    const n = ev.length;
    const target = ev.filter((e) => e.reason === "target");
    const stop = ev.filter((e) => e.reason === "stop");
    const moved = ev.filter((e) => e.reason === "breakeven" || e.reason === "trail");
    const neither = n - target.length - stop.length - moved.length;
    const bars = this.bars;
    return {
      trigger: this.input.trigger,
      n,
      openAtEnd: this.openAtEnd,
      unfilled: this.unfilled,
      skippedGap: this.skippedGap,
      target: prob(target.length, n),
      stop: prob(stop.length, n),
      neither: prob(neither, n),
      moved: prob(moved.length, n),
      expectancy: meanOf(Float64Array.from(ev, (e) => e.r)),
      timeTarget: quart(target.map((e) => e.bars)),
      timeStop: quart(stop.map((e) => e.bars)),
      maeAll: quart(ev.map((e) => e.mae)),
      maeTarget: quart(target.map((e) => e.mae)),
      ambiguous: ev.filter((e) => e.ambiguous).length,
      events: ev,
      fromMs: bars.length ? bars[0]!.t * 1000 : 0,
      toMs: bars.length ? (bars[bars.length - 1]!.t + this.secLen) * 1000 : 0,
    };
  }
}

