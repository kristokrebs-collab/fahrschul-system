/**
 * `evaluateLevel(level, candles, now)` – the pure, deterministic status of ONE key level from real candles.
 *
 * Rules the evaluator keeps:
 * - **No lookahead.** A candle that opened after `now` is ignored; a candle counts as closed only when the feed says so
 *   AND its close time has passed `now`. The same inputs always give the same result (no clock, no randomness).
 * - **Unknown never confirms.** No candles, stale candles, an unusable price or an ATR distance without ATR data give
 *   `unknown` – never `confirmed`, never `waiting` pretending to know.
 * - **Candles are the level's own timeframe.** The caller hands in the candles of `level.tf`; nothing is substituted.
 * - **Intrabar and close are separate.** Only the `running` rule ever shows `provisional` (the forming candle is beyond
 *   the level – confirmed only by its close). A `touch` is a fact the moment a wick reaches the level (irrevocable, so
 *   `confirmed` with basis `intrabar`). `close`, `closes`, `buffer` and `retest` look at CLOSED candles only; the forming
 *   candle just shows in the reason text.
 * - **State machine per level over the closed candles since `level.since`** (the first candle opened at or after it; a
 *   level made today never confirms on yesterday's candles): waiting → confirmed → invalidated (price closed back
 *   across the level, or beyond the invalidation price) → confirmed again with the next fulfilment. A level without
 *   `since` (the five fixed levels) is stateless: only the latest closed candle (the latest N for `closes`) decides, as
 *   `scenario()` always did.
 *
 * "Above" below means direction `above` (close > level); `below` mirrors every comparison.
 */
// relative on purpose: the Netlify alert-watch function bundles this file (alias-free, see netlify/functions/README.md)
import { price as fmtPrice } from "../../lib/format";
import { KEY_TF_MS, type EventBasis, type KeyLevel, type LevelEvaluation, type LevelEvent, type LevelEventKind, type LevelStatus } from "./types";

/** Structurally a `Candle` of the market layer (ms, `closed` = final). */
export interface EvalCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  closed: boolean;
  closeTime?: number;
}

export const ATR_LEN = 14;
/** A touch / retest tolerance for kinds that have no distance of their own (0.15 % of the level). */
export const DEFAULT_RETEST_PCT = 0.15;
/** Closed candles a stateless `retest` level reads. */
const STATELESS_RETEST_BARS = 50;
/** The newest candle must be younger than two intervals (+ grace) – older data is stale, not "waiting". */
const STALE_GRACE_MS = 90_000;
const MAX_EVENTS = 30;

const finiteCandle = (c: EvalCandle): boolean => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close);

/** Wilder ATR(len) as known at the CLOSE of each candle of `closed` (ascending); `null` until `len + 1` candles exist. */
export function atrSeries(closed: readonly EvalCandle[], len: number = ATR_LEN): (number | null)[] {
  const out: (number | null)[] = [];
  let atr = 0;
  for (let i = 0; i < closed.length; i++) {
    if (i === 0) {
      out.push(null);
      continue;
    }
    const c = closed[i]!;
    const p = closed[i - 1]!.close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p), Math.abs(c.low - p));
    if (i < len) {
      atr += tr;
      out.push(null);
    } else if (i === len) {
      atr = (atr + tr) / len;
      out.push(Number.isFinite(atr) && atr > 0 ? atr : null);
    } else {
      atr = (atr * (len - 1) + tr) / len;
      out.push(Number.isFinite(atr) && atr > 0 ? atr : null);
    }
  }
  return out;
}

/** Wilder ATR over `closed` (ascending), as of the newest candle; `null` below `len + 1` candles. */
export function atrOf(closed: readonly EvalCandle[], len: number = ATR_LEN): number | null {
  return atrSeries(closed, len).at(-1) ?? null;
}

/** Price distance of a `Distance` for `level` (`null` = ATR wanted, none available). */
export function distanceDelta(level: Pick<KeyLevel, "price" | "distance">, atr: number | null): number | null {
  const d = level.distance;
  if (!(d.value >= 0) || !Number.isFinite(d.value)) return null;
  if (d.mode === "pct") return (level.price * d.value) / 100;
  return atr == null ? null : d.value * atr;
}

const isAscending = (c: readonly EvalCandle[]): boolean => {
  for (let i = 1; i < c.length; i++) if (c[i]!.time < c[i - 1]!.time) return false;
  return true;
};

function blank(status: LevelStatus, reason: string, patch: Partial<LevelEvaluation> = {}): LevelEvaluation {
  return { status, basis: null, reason, progress: null, trigger: null, last: null, distancePct: null, retest: "none", broke: false, awaitingRetest: false, atr: null, events: [], asOf: null, ...patch };
}

/** Is `c` closed at `now`? The feed's flag AND the clock must agree. */
export function isClosedAt(c: EvalCandle, ms: number, now: number): boolean {
  return c.closed && (c.closeTime ?? c.time + ms - 1) <= now;
}

export function evaluateLevel(level: KeyLevel, candles: readonly EvalCandle[], now: number): LevelEvaluation {
  const ms = KEY_TF_MS[level.tf];
  const p = level.price;
  if (!Number.isFinite(p) || p <= 0) return blank("unknown", "Kein gültiger Preis.");
  const src = isAscending(candles) ? candles : [...candles].sort((a, b) => a.time - b.time);
  const usable = src.filter((c) => finiteCandle(c) && c.time <= now);
  const newest = usable[usable.length - 1];
  if (!newest) return blank("unknown", `Keine ${level.tf}-Kerzen geladen.`);
  if (now - newest.time > 2 * ms + STALE_GRACE_MS) return blank("unknown", `${level.tf}-Kerzen veraltet – nicht bewertet.`, { asOf: newest.time });

  const closed = usable.filter((c) => isClosedAt(c, ms, now));
  const tail = usable[usable.length - 1]!;
  const forming = isClosedAt(tail, ms, now) ? null : tail;
  const asOf = newest.time;
  const up = level.direction === "above";
  const beyond = (x: number, ref: number): boolean => (up ? x > ref : x < ref);
  const reach = (c: Pick<EvalCandle, "high" | "low">): boolean => (up ? c.high >= p : c.low <= p);
  const wrong = (x: number, ref: number): boolean => (up ? x < ref : x > ref);
  const over = up ? "über" : "unter";
  const back = up ? "unter" : "über";

  // ATR as known when a candle opened = the ATR of the candle before it (a candle never sets its own threshold)
  const atrs = atrSeries(closed);
  const atr = atrs.at(-1) ?? null;
  const needsDistance = level.kind === "buffer" || level.kind === "retest";
  const delta = needsDistance ? distanceDelta(level, atr) : null;
  if (needsDistance && delta == null) {
    return blank("unknown", level.distance.mode === "atr" ? "ATR(14) nicht berechenbar – zu wenig Kerzen." : "Ungültiger Abstand.", { asOf });
  }
  const trigger = level.kind === "buffer" ? (up ? p + (delta ?? 0) : p - (delta ?? 0)) : p;
  /** the distance that applied to the candle at `idx` of `closed` (`null`: ATR of the candle before it unknown) */
  const deltaAt = (idx: number): number | null => (level.distance.mode === "atr" ? distanceDelta(level, atrs[idx - 1] ?? null) : delta);
  const touchesZone = (c: EvalCandle, idx: number): boolean => {
    const tol = level.kind === "retest" ? deltaAt(idx) : (p * DEFAULT_RETEST_PCT) / 100;
    return tol != null && (up ? c.low <= p + tol : c.high >= p - tol);
  };

  const since = level.since;
  const need = level.kind === "closes" ? Math.max(1, Math.round(level.closes)) : 1;
  const window = since == null ? closed.slice(-(level.kind === "retest" ? STATELESS_RETEST_BARS : need)) : closed.filter((c) => c.time >= since);

  const events: LevelEvent[] = [];
  const ev = (kind: LevelEventKind, basis: EventBasis, c: EvalCandle, text: string): void => {
    events.push({ at: c.time, kind, basis, price: p, text });
  };

  type State = "waiting" | "confirmed" | "invalidated";
  let state: State = "waiting";
  let streak = 0;
  let phase = 0; // retest: 0 = await break, 1 = await retest
  let breakAt = -1;
  let retestDone = false;
  let broke = false;
  let confirmAt = -1;
  let via: "level" | "price" | null = null;

  const first = closed.length - window.length;
  for (let k = 0; k < window.length; k++) {
    const c = window[k]!;
    const idx = first + k;
    let met = false;
    const beyondClose = beyond(c.close, p);
    if (level.kind === "touch") {
      met = reach(c);
    } else if (level.kind === "running") {
      if (state !== "confirmed") {
        if (reach(c) && beyondClose) ev("provisional", "intrabar", c, `Kurs ${over} ${fmtPrice(p)} (laufende Kerze)`);
        else if (reach(c)) ev("unconfirmed", "intrabar", c, `Kurs kurz ${over} ${fmtPrice(p)}, Schluss zurück – nicht bestätigt`);
      }
      met = beyondClose;
    } else if (level.kind === "close") {
      met = beyondClose;
    } else if (level.kind === "closes") {
      streak = beyondClose ? streak + 1 : 0;
      met = streak >= need;
    } else if (level.kind === "buffer") {
      const d = deltaAt(idx);
      met = d != null && beyond(c.close, up ? p + d : p - d);
    } else {
      // retest: break by close, then a later candle comes back to the level and closes beyond it again
      if (phase === 0 && beyondClose) {
        phase = 1;
        breakAt = c.time;
        broke = true;
        ev("break", "close", c, `Bruch: Schluss ${over} ${fmtPrice(p)}`);
      } else if (phase === 1 && c.time > breakAt) {
        if (!beyondClose) {
          phase = 0;
          broke = false;
          if (state === "waiting") ev("unconfirmed", "close", c, `Schluss zurück ${back} ${fmtPrice(p)} – Bruch zurückgenommen`);
        } else if (touchesZone(c, idx)) met = true;
      }
    }

    if (state !== "confirmed") {
      if (met) {
        state = "confirmed";
        via = null;
        confirmAt = c.time;
        retestDone = level.kind === "retest";
        const basis: EventBasis = level.kind === "touch" ? "intrabar" : "close";
        const text =
          level.kind === "touch"
            ? `Berührung ${fmtPrice(p)} – bestätigt`
            : level.kind === "closes"
              ? `${need} Schlüsse in Folge ${over} ${fmtPrice(p)}`
              : level.kind === "buffer"
                ? `Schluss ${over} ${fmtPrice(trigger)} (Puffer)`
                : level.kind === "retest"
                  ? `Retest bestätigt: Schluss ${over} ${fmtPrice(p)}`
                  : `Schluss ${over} ${fmtPrice(p)}`;
        ev(level.kind === "retest" ? "retest" : level.kind === "touch" ? "touch" : "confirmed", basis, c, text);
      }
    } else {
      // confirmed: did it fail?
      const crossedBack = level.kind !== "touch" && !beyondClose;
      const viaInvalidation = level.invalidation != null && wrong(c.close, level.invalidation);
      if (crossedBack || viaInvalidation) {
        state = "invalidated";
        via = viaInvalidation ? "price" : "level";
        streak = 0;
        phase = 0;
        broke = false;
        retestDone = false;
        ev("invalidated", "close", c, viaInvalidation ? `Schluss ${back} der Invalidierung ${fmtPrice(level.invalidation as number)}` : `Schluss zurück ${back} ${fmtPrice(p)}`);
      } else if (level.kind !== "retest" && !retestDone && c.time > confirmAt && touchesZone(c, idx) && beyondClose) {
        retestDone = true;
        ev("retest", "close", c, `Retest gehalten: Schluss ${over} ${fmtPrice(p)}`);
      }
    }
  }
  if (level.kind !== "retest") broke = state === "confirmed";
  else if (state === "confirmed") broke = true;

  let status: LevelStatus = state;
  let basis: EventBasis | null = state === "confirmed" ? (level.kind === "touch" ? "intrabar" : "close") : state === "invalidated" ? "close" : null;

  // the forming candle: provisional for `running`, a fact for `touch`; every other rule waits for the close
  if (forming) {
    const partial = since != null && forming.time < since; // opened before the level existed: only the price now counts
    const fh = partial ? forming.close : forming.high;
    const fl = partial ? forming.close : forming.low;
    if (level.kind === "touch" && state !== "confirmed" && (up ? fh >= p : fl <= p)) {
      status = "confirmed";
      basis = "intrabar";
      ev("touch", "intrabar", forming, `Berührung ${fmtPrice(p)} (laufende Kerze)`);
    } else if (level.kind === "running" && state !== "confirmed" && beyond(forming.close, p)) {
      status = "provisional";
      basis = "intrabar";
      ev("provisional", "intrabar", forming, `Laufende Kerze ${over} ${fmtPrice(p)} – erst der Schluss bestätigt`);
    }
  }

  const last = forming ? forming.close : (closed[closed.length - 1]?.close ?? null);
  const distancePct = last == null ? null : ((up ? last - trigger : trigger - last) / p) * 100;
  const awaitingRetest = level.kind === "retest" && broke && status !== "confirmed";
  const haveStreak = level.kind === "closes" ? Math.min(streak, need) : 0;

  return {
    status,
    basis,
    reason: reasonOf(level, status, { over, back, trigger, need, streak: haveStreak, awaitingRetest, formingBeyond: forming ? beyond(forming.close, level.kind === "buffer" ? trigger : p) : false, windowEmpty: window.length === 0, via }),
    progress: level.kind === "closes" ? { have: status === "confirmed" ? need : haveStreak, need } : null,
    trigger,
    last,
    distancePct,
    retest: retestDone && status === "confirmed" ? "done" : "none",
    broke: status === "confirmed" || broke,
    awaitingRetest,
    atr,
    events: events.slice(-MAX_EVENTS),
    asOf,
  };
}

interface ReasonCtx {
  over: string;
  back: string;
  trigger: number;
  need: number;
  streak: number;
  awaitingRetest: boolean;
  formingBeyond: boolean;
  windowEmpty: boolean;
  via: "level" | "price" | null;
}

function reasonOf(level: KeyLevel, status: LevelStatus, x: ReasonCtx): string {
  const p = fmtPrice(level.price);
  const tf = level.tf;
  switch (status) {
    case "confirmed":
      switch (level.kind) {
        case "touch":
          return `Berührt: der Kurs hat ${p} erreicht.`;
        case "running":
        case "close":
          return `${tf}-Schluss ${x.over} ${p}.`;
        case "closes":
          return `${x.need} ${tf}-Schlüsse in Folge ${x.over} ${p}.`;
        case "buffer":
          return `${tf}-Schluss ${x.over} ${fmtPrice(x.trigger)} (${p} plus Puffer).`;
        default:
          return `Retest gehalten: Schluss ${x.over} ${p} nach dem Bruch.`;
      }
    case "provisional":
      return `Laufende ${tf}-Kerze ${x.over} ${p} – vorläufig, bestätigt erst mit dem Schluss.`;
    case "invalidated":
      return level.invalidation != null && x.via === "price"
        ? `Zuletzt ${x.back} der Invalidierung ${fmtPrice(level.invalidation)} geschlossen.`
        : `Schluss zurück ${x.back} ${p} – das Signal gilt nicht mehr.`;
    default:
      if (x.windowEmpty && level.since != null) return `Zählt ab der nächsten vollständigen ${tf}-Kerze nach dem Anlegen.`;
      switch (level.kind) {
        case "touch":
          return `Der Kurs hat ${p} noch nicht erreicht.`;
        case "running":
          return `Noch kein Kurs ${x.over} ${p}.`;
        case "close":
          return x.formingBeyond ? `Kurs liegt ${x.over} ${p}, der ${tf}-Schluss steht aus.` : `Wartet auf einen ${tf}-Schluss ${x.over} ${p}.`;
        case "closes":
          return `${x.streak} von ${x.need} ${tf}-Schlüssen ${x.over} ${p}.`;
        case "buffer":
          return x.formingBeyond ? `Kurs ${x.over} ${fmtPrice(x.trigger)}, der ${tf}-Schluss steht aus.` : `Wartet auf einen ${tf}-Schluss ${x.over} ${fmtPrice(x.trigger)} (${p} plus Puffer).`;
        default:
          return x.awaitingRetest ? `Bruch bestätigt (Schluss ${x.over} ${p}) – Retest steht aus.` : `Wartet auf den Bruch: ${tf}-Schluss ${x.over} ${p}, danach der Retest.`;
      }
  }
}

