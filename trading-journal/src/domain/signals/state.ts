/**
 * Candle-close confirmation (ours, decisions 6 + 9, 2026-10-08): every signal of the check carries a state.
 *
 * - `provisional` ("vorläufig · schließt in mm:ss"): the event sits on the FORMING candle (completed with the live price,
 *   it can still vanish before the close).
 * - `confirmed` ("bestätigt"): the event fired on a CLOSED candle of its own timeframe.
 * - `strong` ("stark bestätigt"): still lit after `strongCloses` closes counted from the signal candle's own close
 *   (default 2: the signal candle and the next one closed) and the move held — long: no later close below the signal
 *   candle's low; short: no close above its high. Counting the signal candle's own close keeps the state reachable
 *   inside the default 3-candle window (`signalLookback` includes the running candle).
 * - `none`: no event of that direction in the window.
 *
 * A rung with both a confirmed and a provisional event is `confirmed` (or `strong`): the closed candle decides, the
 * forming event is reported beside it (`forming`). Without an evaluation time every bar counts as closed (the 1:1
 * behaviour of the other journal; back-dated checks only ever see closed bars).
 */
import { tfSeconds, type Side, type SignalCfg } from "./config";
import type { Bar } from "./indicators";
import { WT_RANK, isLongKind, mcbEvents, type WtEvent, type WtKind } from "./mcb";

export type SignalState = "none" | "provisional" | "confirmed" | "strong";

/** Order of the states (comparisons: `STATE_RANK[a] >= STATE_RANK.confirmed`). */
export const STATE_RANK: Readonly<Record<SignalState, number>> = { none: 0, provisional: 1, confirmed: 2, strong: 3 };
export const SIGNAL_STATES: readonly SignalState[] = ["none", "provisional", "confirmed", "strong"];
export const isSignalState = (v: unknown): v is SignalState => typeof v === "string" && (SIGNAL_STATES as readonly string[]).includes(v);
/** Counted as an entry / a confirmed signal. */
export const isConfirmedState = (s: SignalState | null | undefined): boolean => s === "confirmed" || s === "strong";

/** Weight of a provisional rung / part in score and bias (shown, but only half as much as a closed candle). */
export const PROVISIONAL_FACTOR = 0.5;

/** Candle-close state of one rung for one direction. */
export interface RungConf {
  state: SignalState;
  /** the event that decides the state (strongest of the best state; newest on a tie), `null` for `none` */
  event: WtEvent;
  /** closed candles since that event, counting its own close (0 = on the forming candle) */
  closes: number;
  /** the move held since the signal candle (long: no close below its low; short: none above its high) */
  held: boolean;
  /** strongest event of this direction on CLOSED candles in the window (`null` = none) */
  closed: WtEvent;
  /** event of this direction on the forming candle (`null` = none or the last bar is closed) */
  forming: WtEvent;
}

export const NO_CONF: Readonly<RungConf> = Object.freeze({ state: "none", event: null, closes: 0, held: false, closed: null, forming: null });

/** Is the last bar the running candle at `now` (ms)? Without `now` every bar counts as closed. */
export function isForming(bars: readonly Bar[], tf: string, now: number | undefined): boolean {
  const last = bars[bars.length - 1];
  const sec = tfSeconds(tf);
  return !!last && sec > 0 && now !== undefined && Number.isFinite(now) && (last.t + sec) * 1000 > now;
}

/** Close time (ms) of the last bar. */
export function lastCloseAt(bars: readonly Bar[], tf: string): number {
  const last = bars[bars.length - 1];
  return last ? (last.t + tfSeconds(tf)) * 1000 : NaN;
}

interface Candidate {
  kind: WtKind;
  barsAgo: number;
  closes: number;
  held: boolean;
}

const better = (a: Candidate, b: Candidate | null): boolean => !b || WT_RANK[a.kind] > WT_RANK[b.kind] || (WT_RANK[a.kind] === WT_RANK[b.kind] && a.barsAgo < b.barsAgo);
const asEvent = (c: Candidate | null): WtEvent => (c ? { kind: c.kind, barsAgo: c.barsAgo } : null);

/**
 * Candle-close state of both directions of one rung: the MCB events of the `signalLookback` window (the same window
 * and conditions as `wtSignal`), split into the forming candle and closed candles.
 */
export function rungConf(
  bars: readonly Bar[],
  wt1: readonly number[],
  wt2: readonly number[],
  cfg: Pick<SignalCfg, "wtOs" | "wtOb" | "revRange" | "signalLookback">,
  forming: boolean,
  strongCloses: number,
): Record<Side, RungConf> {
  const n = wt1.length;
  const close = bars.map((b) => b.c);
  const from = Math.max(n - Math.min(cfg.signalLookback, n - 2), 2);
  const lastClosed = forming ? n - 2 : n - 1;
  // suffix extremes of the CLOSED closes after each bar (the "held" test)
  const minAfter = new Array<number>(n + 1).fill(Infinity);
  const maxAfter = new Array<number>(n + 1).fill(-Infinity);
  for (let i = lastClosed; i >= 0; i--) {
    minAfter[i] = Math.min(minAfter[i + 1]!, close[i]!);
    maxAfter[i] = Math.max(maxAfter[i + 1]!, close[i]!);
  }
  const pick: Record<Side, { strong: Candidate | null; closed: Candidate | null; forming: Candidate | null }> = {
    long: { strong: null, closed: null, forming: null },
    short: { strong: null, closed: null, forming: null },
  };
  if (n >= 3) {
    for (const e of mcbEvents(wt1, wt2, cfg, close, from)) {
      const k = n - 1 - e.index;
      const side: Side = isLongKind(e.kind) ? "long" : "short";
      const slot = pick[side];
      if (forming && k === 0) {
        const c: Candidate = { kind: e.kind, barsAgo: 0, closes: 0, held: true };
        if (better(c, slot.forming)) slot.forming = c;
        continue;
      }
      const b = bars[e.index]!;
      const held = side === "long" ? minAfter[e.index + 1]! >= b.l : maxAfter[e.index + 1]! <= b.h;
      const c: Candidate = { kind: e.kind, barsAgo: k, closes: forming ? k : k + 1, held };
      if (better(c, slot.closed)) slot.closed = c;
      if (held && c.closes >= strongCloses && better(c, slot.strong)) slot.strong = c;
    }
  }
  const out = {} as Record<Side, RungConf>;
  for (const side of ["long", "short"] as const) {
    const s = pick[side];
    const decide = s.strong ?? s.closed ?? s.forming;
    out[side] = {
      state: s.strong ? "strong" : s.closed ? "confirmed" : s.forming ? "provisional" : "none",
      event: asEvent(decide),
      closes: decide?.closes ?? 0,
      held: decide?.held ?? false,
      closed: asEvent(s.closed),
      forming: asEvent(s.forming),
    };
  }
  return out;
}

/**
 * State of one event on a series (chart markers): `provisional` on the forming candle, else `strong` once
 * `strongCloses` closes passed and the move held, else `confirmed`.
 */
export function eventState(bars: readonly Bar[], index: number, long: boolean, forming: boolean, strongCloses: number): SignalState {
  const n = bars.length;
  if (index < 0 || index >= n) return "none";
  if (forming && index === n - 1) return "provisional";
  const lastClosed = forming ? n - 2 : n - 1;
  const closes = lastClosed - index + 1;
  if (closes < strongCloses) return "confirmed";
  const b = bars[index]!;
  for (let j = index + 1; j <= lastClosed; j++) {
    const c = bars[j]!.c;
    if (long ? c < b.l : c > b.h) return "confirmed";
  }
  return "strong";
}

/** German state words (rows, verdict, chart legend). */
export const STATE_TEXT: Readonly<Record<SignalState, string>> = { none: "kein Signal", provisional: "vorläufig", confirmed: "bestätigt", strong: "stark bestätigt" };

/** `mm:ss` (or `h:mm:ss` from one hour) of a remaining time in ms; `0:00` when over. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** `vorläufig · schließt in 12:04` (the forming candle's countdown; render it from `closesAt` on the shared clock). */
export function provisionalText(msToClose: number): string {
  return `${STATE_TEXT.provisional} · schließt in ${mmss(msToClose)}`;
}

/** Row text of a state: `bestätigt` · `stark bestätigt` · `vorläufig · schließt in 12:04` · `kein Signal`. */
export function stateText(state: SignalState, msToClose?: number): string {
  return state === "provisional" && msToClose !== undefined ? provisionalText(msToClose) : STATE_TEXT[state];
}
