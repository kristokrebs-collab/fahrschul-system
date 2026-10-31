/**
 * "Top-Trader netto" (Binance) – the net position of the exchange's biggest accounts as a curve around zero, the last
 * sign change and its age (pure, no React, no I/O). Inspired by on-chain "whales flip net short" charts, but built ONLY
 * from what the app already loads: the public Binance series `topLongShortPositionRatio` (long share of the positions of
 * the top 20 % accounts by margin, per period) and the candle prices of the same exchange. It is NOT on-chain data and
 * NOT Glassnode; it shows big accounts of ONE exchange, nothing more.
 *
 * - `net = long % − short %` in percentage points (−100 … +100). Positive = more long than short.
 * - A dead band (`TRADER_NET_NEUTRAL_PP`, 1 pp) keeps a curve that wobbles around zero from counting as "flipped":
 *   inside it the side is `neutral`, and a dip into the band does not end a run.
 * - `flip` = the LAST sign change that stuck: the zero crossing (linearly interpolated between two points) after which
 *   the net stayed on the current side (the dead band does not count as the other side). `null` = no change in the
 *   loaded history (then `holdMs` tells how long the side has held at least).
 * - Fewer than `TRADER_NET_MIN_POINTS` points → `status: "short"` (zu wenig Verlauf), none → `"none"`; nothing is
 *   invented or smoothed. A candle price is attached to a point only when a candle covers its time.
 *
 * The sign is shown and explained in the "Warum"-Begründung; it does NOT change the verdict (the Top-Trader-Kombi
 * already scores the same positions with its own threshold, adding the sign would count them twice).
 */
import type { Side } from "./config";

/** A point of the Binance top-trader position series (structurally `RatioPoint`). */
export interface NetRatioPoint {
  /** period boundary (ms) */
  time: number;
  /** long share in percent (0 … 100) */
  longPct: number;
  /** short share in percent (0 … 100) */
  shortPct?: number;
}

/** A candle as far as the net chart reads it (structurally `Candle`). */
export interface NetPriceBar {
  /** open time (ms) */
  time: number;
  open: number;
  close: number;
}

export interface NetPoint {
  /** ms */
  t: number;
  /** long % − short % (percentage points) */
  net: number;
  longPct: number;
  /** price of the candle covering `t` (its open), `null` = no candle covers it */
  price: number | null;
}

export type NetSide = "long" | "short" | "neutral";

export interface NetFlip {
  /** the zero crossing (ms, interpolated between two points) */
  at: number;
  from: Side;
  to: Side;
  /** index of the first point after the crossing */
  index: number;
  /** age at `now` (ms) */
  ageMs: number;
  /** price at the crossing / now, when known */
  priceAt: number | null;
  /** price change from the crossing to the newest known price, percent */
  priceChangePct: number | null;
}

export type TraderNetStatus = "ok" | "short" | "none";

export interface TraderNetView {
  status: TraderNetStatus;
  /** oldest first; empty unless `status === "ok"` */
  points: NetPoint[];
  /** how many points were given (also for `short`) */
  count: number;
  /** newest point (`null` = none) */
  last: NetPoint | null;
  side: NetSide | null;
  /** the last sign change that stuck, `null` = none in the loaded history */
  flip: NetFlip | null;
  /** with no flip: how long the side has held in the loaded history, at least (ms) */
  holdMs: number;
  /** side changes (through the dead band) over the loaded history */
  changes: number;
  /** span of the loaded history (ms) */
  spanMs: number;
  /** newest known price (last candle close), `null` = none */
  priceNow: number | null;
}

export const TRADER_NET_NEUTRAL_PP = 1;
export const TRADER_NET_MIN_POINTS = 12;
/** the series' name wherever the UI shows it – never "Wale", never "Glassnode" */
export const TRADER_NET_SOURCE = "Top-Trader (Binance)";

/** Net of one point in percentage points; the long share alone is enough (`2 · long − 100`), the short share is used when it is there and sane. */
export function netOf(p: NetRatioPoint): number {
  const sane = typeof p.shortPct === "number" && Number.isFinite(p.shortPct) && Math.abs(p.longPct + p.shortPct - 100) < 1;
  return sane ? p.longPct - (p.shortPct as number) : 2 * p.longPct - 100;
}

const sideOf = (net: number): NetSide => (net >= TRADER_NET_NEUTRAL_PP ? "long" : net <= -TRADER_NET_NEUTRAL_PP ? "short" : "neutral");
const sign = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Open of the candle that covers `t` (`bars` sorted, `barMs` long); `null` outside the covered range. */
export function priceAt(bars: readonly NetPriceBar[], t: number, barMs: number): number | null {
  if (!bars.length || !(barMs > 0)) return null;
  let lo = 0;
  let hi = bars.length - 1;
  if (t < bars[0]!.time || t >= bars[hi]!.time + barMs) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid]!.time <= t) lo = mid;
    else hi = mid - 1;
  }
  const bar = bars[lo]!;
  return t - bar.time < barMs && Number.isFinite(bar.open) ? bar.open : null;
}

const EMPTY: TraderNetView = { status: "none", points: [], count: 0, last: null, side: null, flip: null, holdMs: 0, changes: 0, spanMs: 0, priceNow: null };

/**
 * The net view from the position series and the candles. `now` (ms) only ages the flip; `barMs` is the candle length.
 * Bad points (non-finite, out of 0 … 100) are dropped, duplicates by time keep the last.
 */
export function buildTraderNet(positions: readonly NetRatioPoint[] | null | undefined, bars: readonly NetPriceBar[] | null | undefined, now: number, barMs: number): TraderNetView {
  const byTime = new Map<number, NetRatioPoint>();
  for (const p of positions ?? []) {
    if (p && Number.isFinite(p.time) && Number.isFinite(p.longPct) && p.longPct >= 0 && p.longPct <= 100) byTime.set(p.time, p);
  }
  const raw = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (!raw.length) return EMPTY;
  const sortedBars = bars && bars.length ? [...bars].sort((a, b) => a.time - b.time) : [];
  const points: NetPoint[] = raw.map((p) => ({ t: p.time, net: netOf(p), longPct: p.longPct, price: priceAt(sortedBars, p.time, barMs) }));
  const last = points[points.length - 1]!;
  const spanMs = last.t - points[0]!.t;
  const priceNow = sortedBars.length ? (sortedBars[sortedBars.length - 1]!.close ?? null) : null;
  if (points.length < TRADER_NET_MIN_POINTS) return { ...EMPTY, status: "short", count: points.length, last, side: sideOf(last.net), spanMs, priceNow: Number.isFinite(priceNow) ? priceNow : null };

  // side changes through the dead band (a run only ends on a firm point of the other side)
  let state: NetSide = "neutral";
  let changes = 0;
  for (const p of points) {
    const s = sideOf(p.net);
    if (s === "neutral") continue;
    if (state !== "neutral" && s !== state) changes++;
    state = s;
  }
  const current = state; // last firm side (`neutral` only when the whole history sat inside the band)

  // walk back over the current run: points of the current side, or inside the dead band
  let flip: NetFlip | null = null;
  if (current !== "neutral") {
    let j = points.length - 1;
    while (j >= 0 && sideOf(points[j]!.net) !== (current === "long" ? "short" : "long")) j--;
    if (j >= 0) {
      // j = newest firm point of the other side; the crossing is the first step after it that reaches the current sign
      const want = current === "long" ? 1 : -1;
      let m = j + 1;
      while (m < points.length && sign(points[m]!.net) !== want) m++;
      const a = points[m - 1]!;
      const b = points[m]!;
      const dn = b.net - a.net;
      const at = dn === 0 ? b.t : a.t + ((0 - a.net) / dn) * (b.t - a.t);
      const nowPrice = priceNow !== null && Number.isFinite(priceNow) ? priceNow : null;
      // the price at the crossing: the covering candle's open (interpolation is not claimed)
      const pAt = priceAt(sortedBars, Math.round(at), barMs);
      flip = {
        at,
        from: current === "long" ? "short" : "long",
        to: current,
        index: m,
        ageMs: Math.max(0, now - at),
        priceAt: pAt,
        priceChangePct: pAt !== null && nowPrice !== null && pAt > 0 ? ((nowPrice - pAt) / pAt) * 100 : null,
      };
    }
  }
  return {
    status: "ok",
    points,
    count: points.length,
    last,
    side: sideOf(last.net),
    flip,
    holdMs: flip ? 0 : Math.max(0, spanMs),
    changes,
    spanMs,
    priceNow: Number.isFinite(priceNow) ? priceNow : null,
  };
}

// ------------------------------------------------------------------ German texts

const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt1 = (x: number): string => nf1.format(x).replace("-", "−");
/** `+8,2 Pkt.` / `−4,6 Pkt.` (percentage points of long minus short share) */
export const netText = (net: number): string => `${net > 0 ? "+" : ""}${fmt1(net)} Pkt.`;
/** `+2,4 %` / `−3,1 %` */
export const pctText = (x: number): string => `${x > 0 ? "+" : ""}${fmt1(x)} %`;

/** `40 Min.` / `5 Std.` / `3 Tage` – a duration, rounded down (never longer than it was). `null` below 5 minutes. */
export function durationText(ms: number): string | null {
  const min = Math.floor(ms / 60_000);
  if (min < 5) return null;
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} Std.`;
  return `${Math.floor(h / 24)} Tage`;
}

/** `seit 40 Min.` / `seit 5 Std.` / `seit 3 Tagen` / `seit gerade eben`. */
export function sinceText(ms: number): string {
  const d = durationText(ms);
  return d === null ? "seit gerade eben" : `seit ${d.replace(/ Tage$/, " Tagen")}`;
}

export const SIDE_WORD: Readonly<Record<NetSide, string>> = { long: "netto Long", short: "netto Short", neutral: "ausgeglichen" };

/** The plaque line: `netto Short, seit 3 Tagen umgeschlagen` / `netto Long, seit mindestens 20 Tagen unverändert` / `ausgeglichen`. */
export function netHeadline(v: TraderNetView): string {
  if (v.status !== "ok" || !v.side || !v.last) return v.status === "short" ? "zu wenig Verlauf" : "keine Daten";
  if (v.side === "neutral") return `ausgeglichen (${netText(v.last.net)})`;
  if (v.flip) return `${SIDE_WORD[v.side]}, ${sinceText(v.flip.ageMs)} umgeschlagen`;
  return `${SIDE_WORD[v.side]}, im geladenen Verlauf (${durationText(v.holdMs) ?? "kurz"}) unverändert`;
}

/** Second line: the net with its change and, when known, the price since the flip. Facts only. */
export function netDetail(v: TraderNetView): string {
  if (v.status !== "ok" || !v.last) return v.status === "short" ? `Erst ${v.count} Punkte geladen – ab ${TRADER_NET_MIN_POINTS} wird der Verlauf gezeichnet.` : "";
  const parts = [`Netto ${netText(v.last.net)} (Long ${fmt1(v.last.longPct)} %)`];
  if (v.flip && v.flip.priceChangePct !== null) parts.push(`Preis seit dem Umschlag ${pctText(v.flip.priceChangePct)}`);
  return parts.join(" · ");
}

/**
 * One sentence for the "Warum"-Begründung of the LONG side. Status: `met` = big accounts are net long, `unmet` = net short
 * or balanced. It explains, it does not score.
 */
export function netWhy(v: TraderNetView): { status: "met" | "unmet"; reason: string } | null {
  if (v.status !== "ok" || !v.side || !v.last) return null;
  const since = v.flip ? ` – ${sinceText(v.flip.ageMs)} umgeschlagen` : "";
  if (v.side === "long") return { status: "met", reason: `Die größten Konten auf Binance sind netto Long (${netText(v.last.net)})${since}. Das stützt ein Long, zählt aber nicht in die Bewertung: die Top-Trader-Kombi prüft dieselben Positionen schon.` };
  if (v.side === "short") return { status: "unmet", reason: `Die größten Konten auf Binance sind netto Short (${netText(v.last.net)})${since}. Das spricht nicht für ein Long, ändert die Bewertung aber nicht: die Top-Trader-Kombi prüft dieselben Positionen schon.` };
  return { status: "unmet", reason: `Die größten Konten auf Binance sind ausgeglichen (${netText(v.last.net)}) – weder Long noch Short im Vorteil. Ohne Einfluss auf die Bewertung.` };
}

/** What the series is and is not (one sentence each, shown under the chart and in the help text). */
export const TRADER_NET_IS = "Long minus Short der größten Konten (obere 20 % nach Einsatz) auf Binance Futures, aus der öffentlichen Börsen-Statistik.";
export const TRADER_NET_IS_NOT = "Keine On-Chain-Wale und nur eine Börse: sagt nichts über den Kurs voraus.";
