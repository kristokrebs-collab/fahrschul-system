/**
 * The three setups, each a pure function of candles and visible thresholds. A rule is a sentence you could check on the
 * chart with a ruler: every `Hit` carries `reason` (why it is on the list) and `checks` (each condition with its number and
 * its threshold). Nothing here predicts anything; "matched a rule" is all a hit says.
 *
 * - Opening-range breakout (`orb`): the first `orMinutes` of the session set a range (highest high, lowest low of those
 *   bars). The first COMPLETE bar after the range whose CLOSE is beyond the range edge is the breakout – long above the
 *   high, short below the low. Needs every bar from the open to the latest complete bar (a gap means a halt or a thin
 *   stock – the chart is left out, not guessed).
 * - Flag (`flag`): on closes – the `poleBars` closes before the flag gained MORE than `poleMinGain`, and the last
 *   `flagBars` closes lie inside a range (highest − lowest close, divided by the last close) UNDER `flagMaxRange`.
 *   Defaults: 10 bars, +10 %, 5 closes, 5 % (the rule of the trader-scanner skill).
 * - Oversold recovery (`rsi`): Wilder's RSI(`length`) – with `requireBounce` it was under `level` on the bar before and the
 *   last bar closed higher than the one before; without, it is under `level` now.
 */
import { rsi as rsiSeries } from "../signals/indicators";
import { clockText, numText, pctText, priceText } from "./text";
import type { FlagParams, Hit, Level, OrbParams, RsiParams, ScanCandle, SkipReason, Stand } from "./types";

export interface SymbolCtx {
  symbol: string;
  name: string | null;
  /** candle length in ms */
  barMs: number;
  interval: string;
  stand: Stand;
}

export interface SessionCtx {
  openMs: number;
  closeMs: number;
  /** IANA zone the sentences use for clock times */
  timeZone: string;
  /** "NY" | "UTC" */
  zoneLabel: string;
  /** what the session is called in the text ("Handelssitzung", "UTC-Tag") */
  noun: string;
}

export type SetupResult = { hits: Hit[]; skip?: SkipReason; detail?: string };

const volOf = (c: ScanCandle): number => (typeof c.volume === "number" && Number.isFinite(c.volume) ? c.volume : 0);
const turnoverOf = (price: number, vol: number): number | null => (vol > 0 ? price * vol : null);
const tail = <T>(list: readonly T[], n: number): T[] => list.slice(Math.max(0, list.length - n));

/** Complete bars only (`closed: false` is the forming bar), in time order. */
export function completeBars(candles: readonly ScanCandle[]): ScanCandle[] {
  return candles.filter((c) => c.closed !== false && Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.open));
}

/* ------------------------------------------------------------------ opening-range breakout */

export function orbSetup(ctx: SymbolCtx, candles: readonly ScanCandle[], session: SessionCtx, p: OrbParams, asOf: number): SetupResult {
  const { barMs } = ctx;
  if (p.orMinutes * 60_000 < barMs || (p.orMinutes * 60_000) % barMs !== 0) return { hits: [], skip: "bad-params", detail: `${p.orMinutes} Minuten passen nicht zu ${ctx.interval}-Kerzen` };
  const nOr = (p.orMinutes * 60_000) / barMs;
  const end = Math.min(asOf, session.closeMs);
  const slots = Math.floor((end - session.openMs) / barMs); // complete slots so far
  if (slots < nOr) return { hits: [], skip: "range-open" };
  const day = completeBars(candles).filter((c) => c.time >= session.openMs && c.time < session.closeMs && c.time + barMs <= asOf);
  // every slot from the open to the latest complete bar must be there, in order
  if (day.length !== slots || day.some((c, i) => c.time !== session.openMs + i * barMs)) return { hits: [], skip: "gaps", detail: `${day.length} von ${slots} Kerzen vorhanden` };
  const range = day.slice(0, nOr);
  const hi = Math.max(...range.map((c) => c.high));
  const lo = Math.min(...range.map((c) => c.low));
  const rangeVol = range.reduce((a, c) => a + volOf(c), 0) / nOr;
  const sessionVol = day.reduce((a, c) => a + volOf(c), 0);
  const lastClose = day[day.length - 1]!.close;
  const latest = p.latestMinutes == null ? Infinity : session.openMs + p.latestMinutes * 60_000;
  const z = session.zoneLabel;
  const tz = session.timeZone;
  const hits: Hit[] = [];
  const rangeText = `${clockText(session.openMs, tz)}–${clockText(session.openMs + nOr * barMs, tz)} ${z}`;
  for (const side of ["long", "short"] as const) {
    if (p.sides !== "both" && p.sides !== side) continue;
    let k = -1;
    for (let i = nOr; i < day.length; i++) {
      const b = day[i]!;
      if (b.time + barMs > latest) break;
      const beyond = side === "long" ? b.close > hi * (1 + p.minBreak) : b.close < lo * (1 - p.minBreak);
      if (beyond) {
        k = i;
        break;
      }
    }
    if (k < 0) continue;
    const b = day[k]!;
    const edge = side === "long" ? hi : lo;
    const over = side === "long" ? b.close / hi - 1 : 1 - b.close / lo;
    const rel = rangeVol > 0 ? volOf(b) / rangeVol : null;
    if (p.minRelVolume > 0 && (rel == null || rel < p.minRelVolume)) continue;
    const still = side === "long" ? lastClose > hi : lastClose < lo;
    if (p.stillBeyond && !still) continue;
    const closeAt = b.time + barMs;
    const word = side === "long" ? "über dem Spannenhoch" : "unter dem Spannentief";
    const checks = [
      `Eröffnungsspanne ${rangeText}: Hoch ${priceText(hi)}, Tief ${priceText(lo)} (${nOr} Kerzen à ${ctx.interval})`,
      `Erste vollständige Kerze nach der Spanne mit Schluss ${side === "long" ? "über dem Hoch" : "unter dem Tief"}: ${clockText(b.time, tz)}–${clockText(closeAt, tz)} ${z}, Schluss ${priceText(b.close)} (${pctText(over, 2)} ${side === "long" ? "über" : "unter"} ${priceText(edge)}${p.minBreak > 0 ? `, Schwelle ${pctText(p.minBreak, 2, false)}` : ""})`,
      still ? `Die letzte vollständige Kerze (${priceText(lastClose)}) liegt noch ${side === "long" ? "über" : "unter"} der Spanne` : `Die letzte vollständige Kerze (${priceText(lastClose)}) liegt nicht mehr ${side === "long" ? "über" : "unter"} der Spanne – der Kurs ist weitergezogen`,
    ];
    if (rel != null && p.minRelVolume > 0) checks.push(`Volumen der Ausbruchskerze ${numText(rel, 1)}× der Spannen-Kerzen (Schwelle ${numText(p.minRelVolume, 1)}×)`);
    hits.push({
      id: `${ctx.symbol}:orb:${side}:${day[0]!.time}`,
      symbol: ctx.symbol,
      name: ctx.name,
      setup: "orb",
      side,
      price: lastClose,
      at: closeAt,
      metric: { label: side === "long" ? "über Spannenhoch" : "unter Spannentief", value: over, text: pctText(over, 2) },
      reason: `Schloss um ${clockText(closeAt, tz)} ${z} bei ${priceText(b.close)} ${word} ${priceText(edge)} (${pctText(over, 2)}) – Spanne ${rangeText}.`,
      checks,
      levels: [
        { label: "Spannenhoch", price: hi },
        { label: "Spannentief", price: lo },
      ],
      marks: [{ time: b.time, label: "Ausbruch" }],
      turnover: turnoverOf(lastClose, sessionVol),
      preview: day.slice(-96),
      interval: ctx.interval,
      stand: { ...ctx.stand, lastBar: day[day.length - 1]!.time },
    });
  }
  return { hits };
}

/* ------------------------------------------------------------------ flag */

export function flagSetup(ctx: SymbolCtx, candles: readonly ScanCandle[], p: FlagParams): SetupResult {
  const bars = completeBars(candles);
  const n = bars.length;
  const need = p.poleBars + p.flagBars + 1;
  if (n < need) return { hits: [], skip: "few-bars", detail: `${n} von mindestens ${need} Kerzen` };
  const c = bars.map((b) => b.close);
  const last = c[n - 1]!;
  const poleEnd = n - p.flagBars - 1;
  const poleStart = poleEnd - p.poleBars;
  const gain = c[poleEnd]! / c[poleStart]! - 1;
  const flag = c.slice(n - p.flagBars);
  const fHi = Math.max(...flag);
  const fLo = Math.min(...flag);
  const range = (fHi - fLo) / last;
  if (!(gain > p.poleMinGain) || !(range < p.flagMaxRange)) return { hits: [] };
  const unit = ctx.interval === "1d" ? "Tagen" : `${ctx.interval}-Kerzen`;
  const lastBar = bars[n - 1]!;
  const hit: Hit = {
    id: `${ctx.symbol}:flag:long:${lastBar.time}`,
    symbol: ctx.symbol,
    name: ctx.name,
    setup: "flag",
    side: "long",
    price: last,
    at: lastBar.time + ctx.barMs,
    metric: { label: "Anstieg davor", value: gain, text: pctText(gain, 1) },
    reason: `Erst ${pctText(gain, 1)} in ${p.poleBars} ${unit} (${priceText(c[poleStart]!)} → ${priceText(c[poleEnd]!)}), dann ${p.flagBars} Schlusskurse in einer Spanne von nur ${pctText(range, 1, false)}.`,
    checks: [
      `Anstieg: ${pctText(gain, 1)} über ${p.poleBars} Kerzen, Schlusskurs ${priceText(c[poleStart]!)} → ${priceText(c[poleEnd]!)} (Schwelle: mehr als ${pctText(p.poleMinGain, 1, false)})`,
      `Fahne: die letzten ${p.flagBars} Schlusskurse zwischen ${priceText(fLo)} und ${priceText(fHi)} = ${pctText(range, 1, false)} vom letzten Schluss ${priceText(last)} (Schwelle: unter ${pctText(p.flagMaxRange, 1, false)})`,
    ],
    levels: [
      { label: "Fahnen-Hoch (Schluss)", price: fHi },
      { label: "Fahnen-Tief (Schluss)", price: fLo },
    ],
    marks: [
      { time: bars[poleStart]!.time, label: "Anstieg ab" },
      { time: bars[poleEnd]!.time, label: "Fahne ab" },
    ],
    turnover: turnoverOf(last, volOf(lastBar)),
    preview: tail(bars, Math.max(60, need + 10)),
    interval: ctx.interval,
    stand: { ...ctx.stand, lastBar: lastBar.time },
  };
  return { hits: [hit] };
}

/* ------------------------------------------------------------------ oversold recovery */

export function rsiSetup(ctx: SymbolCtx, candles: readonly ScanCandle[], p: RsiParams): SetupResult {
  const bars = completeBars(candles);
  const n = bars.length;
  if (n < p.length + 2) return { hits: [], skip: "few-bars", detail: `${n} von mindestens ${p.length + 2} Kerzen` };
  const r = rsiSeries(
    bars.map((b) => b.close),
    p.length,
  );
  const now = r[n - 1]!;
  const prev = r[n - 2]!;
  if (!Number.isFinite(now) || !Number.isFinite(prev)) return { hits: [], skip: "few-bars", detail: "RSI noch nicht berechenbar" };
  const last = bars[n - 1]!;
  const before = bars[n - 2]!;
  const up = last.close > before.close;
  const bounce = p.requireBounce ? prev < p.level && up : now < p.level;
  if (!bounce) return { hits: [] };
  const change = last.close / before.close - 1;
  const checks = p.requireBounce
    ? [`RSI(${p.length}) auf der Kerze davor: ${numText(prev, 1)} (Schwelle: unter ${numText(p.level, 0)})`, `Letzte Kerze schloss höher als die davor: ${priceText(before.close)} → ${priceText(last.close)} (${pctText(change, 2)})`, `RSI(${p.length}) jetzt: ${numText(now, 1)}`]
    : [`RSI(${p.length}) jetzt: ${numText(now, 1)} (Schwelle: unter ${numText(p.level, 0)})`];
  const levels: Level[] = [];
  const hit: Hit = {
    id: `${ctx.symbol}:rsi:long:${last.time}`,
    symbol: ctx.symbol,
    name: ctx.name,
    setup: "rsi",
    side: "long",
    price: last.close,
    at: last.time + ctx.barMs,
    metric: { label: `RSI(${p.length})`, value: p.requireBounce ? prev : now, text: numText(p.requireBounce ? prev : now, 1) },
    reason: p.requireBounce
      ? `RSI(${p.length}) lag zuvor bei ${numText(prev, 1)} (unter ${numText(p.level, 0)}), die letzte Kerze schloss ${pctText(change, 2)} höher (${priceText(before.close)} → ${priceText(last.close)}).`
      : `RSI(${p.length}) steht bei ${numText(now, 1)}, unter der Schwelle ${numText(p.level, 0)}.`,
    checks,
    levels,
    marks: p.requireBounce ? [{ time: before.time, label: "RSI unter Schwelle" }] : [],
    turnover: turnoverOf(last.close, volOf(last)),
    preview: tail(bars, 60),
    interval: ctx.interval,
    stand: { ...ctx.stand, lastBar: last.time },
  };
  return { hits: [hit] };
}
