/**
 * Ausgang je Signal (F32): what happened after an archived signal, read from the REAL candles that followed it. Pure,
 * deterministic, no I/O – the candles come in as an argument (the market layer loads them on demand, see
 * `src/market/signalOutcomes.ts`), the result is computed whenever it is needed and never stored as a fact (the market layer
 * keeps only a small versioned cache of FINAL results).
 *
 * Reading rules (each one is disclosed on screen, none of them is tuned):
 * - The candle the signal fell into does not count (it is half before the signal, its order of events is unknown); the first
 *   candle that OPENS at or after the signal is the first one. With no price of its own the entry is that candle's open.
 * - Stop and target are the signal's own marks when it had them (Box setup: entry / stop / first target; an own key level:
 *   its invalidation as the stop). A missing mark is filled with the standard measure – stop 1,5 × ATR(14, 1h), target 2 R –
 *   and the outcome is then labelled `standard` instead of `own`; both are never mixed silently.
 * - A signal with its own entry price counts as entered only once a candle's range touches that price; a stop or target
 *   reached before is `unusable` (not entered).
 * - Target first → `target` (+R), stop first → `stop` (−1 R). Both inside the SAME candle: the order inside a candle is not
 *   in the data, so the stop counts (the cautious reading) and the result says `sameBar`.
 * - Neither reached within the candles that exist (or within `OUTCOME_HORIZON_MS`) → `open`. No usable candles, no direction,
 *   marks on the wrong side of the entry → `unusable` with the reason.
 * No fees, no slippage, no funding: it is the path of the price, not a booked trade.
 */
import type { SignalEvent } from "./archive";

/** One candle; `time` = open time in ms. */
export interface OutcomeBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type OutcomeKind = "target" | "stop" | "open" | "unusable";
/** `own`: stop and target are the signal's; `standard`: at least one was filled with the standard measure. */
export type OutcomeBasis = "own" | "standard";

export const STANDARD_STOP_ATR = 1.5;
export const STANDARD_RR = 2;
/** A signal is followed for this long; neither mark reached by then → `open` ("kein Ausgang im Zeitlimit"). */
export const OUTCOME_HORIZON_MS = 14 * 86_400_000;
/** Version of the cached final results (`src/market/signalOutcomes.ts`); bump when the reading rules change. */
export const OUTCOME_RULES_VERSION = 1;

export interface SignalOutcome {
  kind: OutcomeKind;
  basis: OutcomeBasis | null;
  /** target and stop lay inside one candle: the stop counts (disclosed) */
  sameBar: boolean;
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** R of the target (target distance ÷ stop distance) */
  rr: number | null;
  /** +rr (target) / −1 (stop) / `null` (open, unusable) */
  r: number | null;
  /** open time (ms) of the candle that decided it */
  hitAt: number | null;
  /** candles read after the signal */
  bars: number;
  /** open time (ms) of the newest candle read */
  coveredUntil: number | null;
  /** only for `open`: the horizon passed without a decision */
  horizon: boolean;
  /** German reason (`unusable`, or the note of an `open` result) */
  reason: string | null;
}

export interface OutcomeContext {
  now: number;
  /** ATR(14) of the 1h candles before the signal in % of price (`atrPctAt`), `null` = not known */
  atrPct: number | null;
  /** length of one candle in `bars`, ms */
  intervalMs: number;
}

const blank = (over: Partial<SignalOutcome>): SignalOutcome => ({ kind: "unusable", basis: null, sameBar: false, entry: null, stop: null, target: null, rr: null, r: null, hitAt: null, bars: 0, coveredUntil: null, horizon: false, reason: null, ...over });

export const unusable = (reason: string): SignalOutcome => blank({ kind: "unusable", reason });

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Does the event carry what the reading needs (a direction and a market)? `null` = yes, else the reason. */
export function outcomeBlocker(e: Pick<SignalEvent, "side" | "symbol">): string | null {
  if (!e.side) return "Das Signal hat keine Richtung.";
  if (!e.symbol) return "Der Markt des Signals ist nicht bekannt.";
  return null;
}

/** Whether the event needs the ATR (a mark is missing) – the market layer loads the 1h candles for those only. */
export function needsAtr(e: Pick<SignalEvent, "stop">): boolean {
  return !fin(e.stop);
}

/** The outcome of one signal from the candles (`bars` ascending, any range – only those after the signal count). */
export function evaluateSignal(e: Pick<SignalEvent, "at" | "side" | "symbol" | "price" | "stop" | "target">, bars: readonly OutcomeBar[], ctx: OutcomeContext): SignalOutcome {
  const blocked = outcomeBlocker(e);
  if (blocked) return unusable(blocked);
  const side = e.side!;
  const long = side === "long";
  const horizonEnd = e.at + OUTCOME_HORIZON_MS;
  const after = bars.filter((b) => b.time >= e.at && b.time < horizonEnd && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.open));
  if (!after.length) {
    // too fresh for any candle to have opened since – not an error, simply not decided yet
    return ctx.now - e.at < 2 * ctx.intervalMs + 60_000 ? blank({ kind: "open", reason: "Seit dem Signal ist noch keine volle Kerze vergangen." }) : unusable("Für den Zeitraum nach dem Signal liegen keine Kerzen vor.");
  }
  const ownEntry = fin(e.price) ? e.price : null;
  // the entry: the signal's price, else the open of the first candle
  const entry = ownEntry ?? after[0]!.open;
  let stop = fin(e.stop) ? e.stop : null;
  let target = fin(e.target) ? e.target : null;
  let filled = false;
  if (stop == null) {
    if (ctx.atrPct == null || !(ctx.atrPct > 0)) return unusable("Ohne eigenen Stopp und ohne ATR vor dem Signal gibt es kein Standardmaß.");
    const dist = (STANDARD_STOP_ATR * ctx.atrPct * entry) / 100;
    stop = long ? entry - dist : entry + dist;
    filled = true;
  }
  const risk = long ? entry - stop : stop - entry;
  if (!(risk > 0)) return unusable("Der Stopp liegt auf der falschen Seite des Einstiegs.");
  if (target == null) {
    target = long ? entry + STANDARD_RR * risk : entry - STANDARD_RR * risk;
    filled = true;
  }
  const reward = long ? target - entry : entry - target;
  if (!(reward > 0)) return unusable("Das Ziel liegt auf der falschen Seite des Einstiegs.");
  const rr = reward / risk;
  const base = { basis: (filled ? "standard" : "own") as OutcomeBasis, entry, stop, target, rr };
  let entered = ownEntry == null;
  let read = 0;
  let last: number | null = null;
  for (const b of after) {
    read += 1;
    last = b.time;
    if (!entered) {
      const touches = b.low <= entry && entry <= b.high;
      const beyond = long ? b.high >= target : b.low <= target;
      if (!touches) {
        // the target was reached while the entry price was never touched: the trade would not have happened
        if (beyond) return blank({ ...base, kind: "unusable", bars: read, coveredUntil: last, reason: "Der Einstiegskurs wurde nicht erreicht, bevor das Ziel lag." });
        continue;
      }
      entered = true;
    }
    const stopHit = long ? b.low <= stop : b.high >= stop;
    const targetHit = long ? b.high >= target : b.low <= target;
    if (stopHit) return blank({ ...base, kind: "stop", sameBar: targetHit, r: -1, hitAt: b.time, bars: read, coveredUntil: last });
    if (targetHit) return blank({ ...base, kind: "target", r: rr, hitAt: b.time, bars: read, coveredUntil: last });
  }
  if (!entered) return blank({ ...base, kind: "open", bars: read, coveredUntil: last, reason: "Der Einstiegskurs wurde noch nicht erreicht." });
  const horizon = e.at + OUTCOME_HORIZON_MS <= ctx.now;
  return blank({ ...base, kind: "open", bars: read, coveredUntil: last, horizon, reason: horizon ? "Weder Stopp noch Ziel innerhalb von 14 Tagen." : null });
}

export const OUTCOME_LABEL: Readonly<Record<OutcomeKind, string>> = { target: "Ziel zuerst", stop: "Stopp zuerst", open: "Noch offen", unusable: "Nicht auswertbar" };

/** Short German line of an outcome ("Ziel zuerst · +2,0 R · Standardmaß"). */
export function outcomeText(o: SignalOutcome): string {
  const r = (v: number): string => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1).replace(".", ",")} R`;
  if (o.kind === "unusable") return `${OUTCOME_LABEL.unusable}: ${o.reason ?? "unbekannt"}`;
  const basis = o.basis === "standard" ? " · Standardmaß" : o.basis === "own" ? " · Marken des Signals" : "";
  if (o.kind === "open") return `${OUTCOME_LABEL.open}${o.horizon ? " (Zeitlimit)" : ""}${basis}`;
  return `${OUTCOME_LABEL[o.kind]} · ${r(o.r ?? 0)}${o.sameBar ? " · gleiche Kerze, Stopp zählt" : ""}${basis}`;
}

/** An outcome that cannot change any more (cached by the market layer). */
export const isFinalOutcome = (o: SignalOutcome): boolean => o.kind === "target" || o.kind === "stop" || (o.kind === "open" && o.horizon) || (o.kind === "unusable" && o.bars > 0);

/** Outcomes by event id. */
export type OutcomeMap = ReadonlyMap<string, SignalOutcome>;

/** Decided = a stop or the target was reached first. */
export const isDecided = (o: SignalOutcome | undefined): o is SignalOutcome & { kind: "target" | "stop" } => !!o && (o.kind === "target" || o.kind === "stop");
