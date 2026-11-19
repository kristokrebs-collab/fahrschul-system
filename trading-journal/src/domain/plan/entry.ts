/**
 * Einstiegs-Timer (nach dem Skill trader-entry): die Opening-Range der ersten N Minuten einer Sitzung und der Moment, in
 * dem sie bricht. Marktneutral: Eingabe sind ein Symbol-Name, Kerzen (Krypto jetzt, Aktien über denselben `Candle`-Typ)
 * und die Sitzung.
 *
 * Die Regel, wörtlich wie im Skill, plus die Short-Seite:
 *  - Die Range ist Hoch und Tief der ersten N Minuten der Sitzung (bei 5-Minuten-Kerzen und N = 15: die Kerzen 9:30, 9:35, 9:40).
 *  - Das Signal ist die ERSTE vollständig geschlossene Kerze NACH der Range, deren SCHLUSS außerhalb liegt: über dem Hoch
 *    = Long, unter dem Tief = Short. Ein Docht zählt nicht, ein Schluss genau auf dem Niveau auch nicht.
 *  - Die Zeit des Signals ist der Schlusszeitpunkt dieser Kerze, der Preis ihr Schluss.
 *  - Eine Kerze, die noch läuft, zählt nie. Eine Kerze zählt erst, wenn die Uhr ihren Schluss überschritten hat UND die Daten
 *    sie als geschlossen liefern (`Candle.closed`) – die Börse liefert den Schluss manchmal eine Minute später.
 *  - Nach dem letzten Einstieg der Sitzung (`session.cutoffMs`; am US-Börsentag 15:30, am 13-Uhr-Schluss 12:30) gibt es kein
 *    Signal mehr: "abgelaufen".
 *  - Ein optionaler Volumenfilter verlangt, dass die Signal-Kerze mindestens das X-Fache des Range-Durchschnitts hatte.
 * Fehlt eine Kerze mitten in den Daten, sagt der Timer "keine Daten", statt über die Lücke hinweg zu raten.
 */
import type { Candle } from "@/market/types";
import type { Side } from "../types";
import { num, priceText, signedPctText } from "./format";
import type { SessionDay } from "./sessions";
import { clockIn, dayKeyLabel, MIN } from "./time";

export type EntrySides = "both" | Side;
export type EntryStatus = "invalid" | "closed" | "not-open" | "forming" | "waiting" | "triggered" | "expired" | "no-data";

export interface EntryParams {
  /** first N minutes of the session; a whole multiple of the candle length */
  orMinutes: number;
  sides: EntrySides;
  /** the signal candle needs at least this multiple of the range's average volume; `null` = off */
  minVolumeX: number | null;
}

export interface EntryInput extends EntryParams {
  symbol: string;
  candles: readonly Candle[];
  intervalMs: number;
  session: SessionDay;
  now: number;
  /** price step, for the number of decimals in the words (default 0,01) */
  tick?: number | null;
}

export interface RangeInfo {
  high: number;
  low: number;
  mid: number;
  height: number;
  /** closed candles of the range so far / needed */
  bars: number;
  of: number;
  startMs: number;
  endMs: number;
  complete: boolean;
  /** average volume of the range candles, `null` without volumes */
  avgVolume: number | null;
}

export interface EntrySignal {
  side: Side;
  /** open time of the signal candle */
  barOpen: number;
  /** the moment it closed – the time of the signal */
  barClose: number;
  /** its close – the price of the signal */
  price: number;
  /** the range edge that was broken */
  level: number;
  /** how far beyond the level it closed, in the signal's direction (fraction) */
  beyondPct: number;
  /** its volume ÷ the range's average, `null` without volumes */
  volumeX: number | null;
  /** minutes since it closed (at `now`) */
  ageMin: number;
  /** older than one candle: a late entry is another trade */
  late: boolean;
}

export interface EntryResult {
  status: EntryStatus;
  /** one line: where things stand */
  headline: string;
  /** the why / why not, in words (one line each) */
  reasons: string[];
  range: RangeInfo | null;
  signal: EntrySignal | null;
  /** the newest closed candle of the session */
  last: { time: number; closeMs: number; close: number } | null;
  /** the candle that is still running (its time and the price so far, `null` when the data does not hold it) */
  forming: { time: number; closeMs: number; price: number | null } | null;
  /** the last moment a signal still counts */
  cutoffMs: number;
  /** the session is over: this is a look back */
  past: boolean;
  /** a note when the data is older than it should be */
  stale: string | null;
  /** the closed candles of the session that were used */
  used: number;
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** "5-Minuten-Kerzen", "1-Stunden-Kerzen". */
export function intervalText(ms: number): string {
  const m = Math.round(ms / MIN);
  return m % 60 === 0 ? `${m / 60}-Stunden-Kerzen` : `${m}-Minuten-Kerzen`;
}

/** `null` when the timeframe fits the session and the range, else why not. */
export function validateTimeframe(session: SessionDay, intervalMs: number, orMinutes: number): string | null {
  if (!(intervalMs >= MIN)) return "Kein Zeitrahmen gewählt.";
  if (session.openMs % intervalMs !== 0) {
    return `Die Sitzung beginnt um ${clockIn(session.openMs, session.tz)} Uhr – ${intervalText(intervalMs)} beginnen nicht zu dieser Uhrzeit. Wähle einen kleineren Zeitrahmen.`;
  }
  if (!(orMinutes > 0) || (orMinutes * MIN) % intervalMs !== 0) {
    return `Die Range (${orMinutes} Minuten) ist kein Vielfaches der Kerzenlänge (${intervalText(intervalMs)}).`;
  }
  return null;
}

/** Closed candles ending at or before `upToMs`, ascending, one per open time. */
export function closedUpTo(candles: readonly Candle[], intervalMs: number, upToMs: number): Candle[] {
  const by = new Map<number, Candle>();
  for (const c of candles) if (c.closed && c.time + intervalMs <= upToMs) by.set(c.time, c);
  return [...by.values()].sort((a, b) => a.time - b.time);
}

/**
 * ATR (Skill trader-exit): the simple average of the last `n` true ranges of the given candles. The first candle has no
 * previous close – its true range is high − low. Fewer than `n` candles average all of them (`bars` says how many), fewer
 * than 3 give `null`.
 */
export function atrOf(candles: readonly { high: number; low: number; close: number }[], n = 14): { value: number; bars: number } | null {
  if (candles.length < 3) return null;
  const trs: number[] = [];
  let prev: number | null = null;
  for (const c of candles) {
    let tr = c.high - c.low;
    if (prev != null) tr = Math.max(tr, Math.abs(c.high - prev), Math.abs(c.low - prev));
    trs.push(tr);
    prev = c.close;
  }
  const use = trs.slice(-n);
  return { value: use.reduce((s, x) => s + x, 0) / use.length, bars: use.length };
}

const sidesAllow = (sides: EntrySides, side: Side): boolean => sides === "both" || sides === side;
const sideName = (s: Side): string => (s === "long" ? "Long" : "Short");

/** The entry timer: where the opening-range setup stands at `now`, with the reasons in words. */
export function entryTimer(i: EntryInput): EntryResult {
  const { session, intervalMs, now, orMinutes } = i;
  const tick = i.tick != null && i.tick > 0 ? i.tick : 0.01;
  const P = (x: number): string => priceText(x, tick);
  const T = (ms: number): string => clockIn(ms, session.tz);
  const past = now >= session.closeMs;
  const base: EntryResult = {
    status: "no-data",
    headline: "",
    reasons: [],
    range: null,
    signal: null,
    last: null,
    forming: null,
    cutoffMs: session.cutoffMs,
    past,
    stale: null,
    used: 0,
  };
  const done = (patch: Partial<EntryResult>): EntryResult => ({ ...base, ...patch });

  if (!session.tradingDay) {
    return done({
      status: "closed",
      headline: `Keine Sitzung am ${dayKeyLabel(session.dayKey)}: ${session.closedReason ?? "geschlossen"}.`,
      reasons: [session.calendarKnown ? "Die Börse hat an diesem Tag zu – es gibt keine Range und kein Signal." : "Der Feiertagskalender der App kennt dieses Jahr nicht; erkannt werden nur Wochenenden."],
    });
  }
  const cfg = validateTimeframe(session, intervalMs, orMinutes);
  if (cfg) return done({ status: "invalid", headline: cfg, reasons: [cfg] });

  const nOr = Math.round((orMinutes * MIN) / intervalMs);
  const orEnd = session.openMs + orMinutes * MIN;
  const earlyNote = session.earlyClose ? " (heute schließt die Börse schon um 13:00)" : "";
  const cutoffLine = `Letzter Einstieg: ${T(session.cutoffMs)} Uhr${earlyNote}.`;

  // aligned candles of the session, one per slot (a live tick between two candle starts is not a candle)
  const bySlot = new Map<number, Candle>();
  for (const c of i.candles) {
    const rel = c.time - session.openMs;
    if (rel < 0 || c.time >= session.closeMs || rel % intervalMs !== 0) continue;
    if (![c.open, c.high, c.low, c.close].every(fin)) continue;
    bySlot.set(rel / intervalMs, c);
  }
  const counts = (c: Candle): boolean => c.closed && c.time + intervalMs <= now;

  const closedSlots = [...bySlot.entries()].filter(([, c]) => counts(c)).sort((a, b) => a[0] - b[0]);
  const lastClosed = closedSlots.length ? closedSlots[closedSlots.length - 1]![1] : null;
  const last = lastClosed ? { time: lastClosed.time, closeMs: lastClosed.time + intervalMs, close: lastClosed.close } : null;

  // the candle that runs right now
  let forming: EntryResult["forming"] = null;
  if (now >= session.openMs && now < session.closeMs) {
    const slot = Math.floor((now - session.openMs) / intervalMs);
    const start = session.openMs + slot * intervalMs;
    const c = bySlot.get(slot);
    forming = { time: start, closeMs: start + intervalMs, price: c && !counts(c) ? c.close : null };
  }
  const formingLine = (): string | null =>
    forming ? `Die Kerze ${T(forming.time)} läuft noch${forming.price != null ? ` (bisher ${P(forming.price)})` : ""} und schließt um ${T(forming.closeMs)} Uhr – sie zählt erst nach ihrem Schluss.` : null;

  if (now < session.openMs) {
    return done({
      status: "not-open",
      headline: `Die Sitzung beginnt um ${T(session.openMs)} Uhr ${session.zone} (${session.openBerlin} Uhr in Berlin).`,
      reasons: [`Die Range entsteht in den ersten ${orMinutes} Minuten (${nOr} ${nOr === 1 ? "Kerze" : "Kerzen"}); erst danach kann ein Signal kommen.`, cutoffLine],
      forming: null,
    });
  }

  const orBars = closedSlots.filter(([slot]) => slot < nOr).map(([, c]) => c);
  const volumes = orBars.map((c) => c.volume).filter((v) => fin(v) && v > 0);
  const avgVolume = volumes.length === orBars.length && volumes.length ? volumes.reduce((s, x) => s + x, 0) / volumes.length : null;
  const mkRange = (complete: boolean): RangeInfo | null => {
    if (!orBars.length) return null;
    const high = Math.max(...orBars.map((c) => c.high));
    const low = Math.min(...orBars.map((c) => c.low));
    return { high, low, mid: (high + low) / 2, height: high - low, bars: orBars.length, of: nOr, startMs: session.openMs, endMs: orEnd, complete, avgVolume };
  };

  if (now < orEnd) {
    const partial = mkRange(false);
    return done({
      status: "forming",
      headline: `Range entsteht: ${orBars.length} von ${nOr} Kerzen geschlossen – fertig um ${T(orEnd)} Uhr.`,
      reasons: [partial ? `Bisher: Hoch ${P(partial.high)}, Tief ${P(partial.low)}.` : "Noch keine Kerze der Range ist geschlossen.", "Vor dem Ende der Range gibt es kein Signal.", formingLine(), cutoffLine].filter((x): x is string => !!x),
      range: partial,
      last,
      forming,
      used: closedSlots.length,
    });
  }

  if (orBars.length < nOr) {
    const missing = Array.from({ length: nOr }, (_, k) => k)
      .filter((k) => !closedSlots.some(([slot]) => slot === k))
      .map((k) => T(session.openMs + k * intervalMs));
    return done({
      status: "no-data",
      headline: `Keine Daten für die Range: ${orBars.length} von ${nOr} Kerzen.`,
      reasons: [`Es fehlen die Kerzen ${missing.join(", ")}. Ohne sie lassen sich Hoch und Tief der Range nicht bestimmen – die App schätzt nichts.`],
      range: mkRange(false),
      last,
      forming,
      used: closedSlots.length,
    });
  }

  const range = mkRange(true)!;
  const reasons: string[] = [];
  const skippedThin: string[] = [];
  const skippedSide: string[] = [];
  let signal: EntrySignal | null = null;
  let gapAt: number | null = null;
  let pendingAt: number | null = null;

  for (let slot = nOr; ; slot++) {
    const start = session.openMs + slot * intervalMs;
    const end = start + intervalMs;
    if (end > session.cutoffMs || end > now) break;
    const c = bySlot.get(slot);
    if (!c) {
      // the newest candle is allowed to be late; an older hole is a real gap
      if (end > now - 2 * intervalMs - 90_000) pendingAt = start;
      else gapAt = start;
      break;
    }
    if (!c.closed) {
      pendingAt = start;
      break;
    }
    const dir: Side | null = c.close > range.high ? "long" : c.close < range.low ? "short" : null;
    if (!dir) continue;
    if (!sidesAllow(i.sides, dir)) {
      skippedSide.push(`Die Kerze ${T(start)} schloss ${dir === "long" ? "über dem Hoch" : "unter dem Tief"} der Range – das ist nicht deine Richtung (${i.sides === "long" ? "nur Long" : "nur Short"}).`);
      continue;
    }
    const volumeX = avgVolume && fin(c.volume) && c.volume > 0 ? c.volume / avgVolume : null;
    if (i.minVolumeX != null && i.minVolumeX > 0 && (volumeX == null || volumeX < i.minVolumeX)) {
      skippedThin.push(`Die Kerze ${T(start)} schloss ${dir === "long" ? "über dem Hoch" : "unter dem Tief"}, aber mit ${volumeX == null ? "unbekanntem Volumen" : `nur ${num(volumeX, 2)}× dem Range-Volumen`} (verlangt: ${num(i.minVolumeX, 2)}×) – übergangen.`);
      continue;
    }
    const level = dir === "long" ? range.high : range.low;
    signal = {
      side: dir,
      barOpen: start,
      barClose: end,
      price: c.close,
      level,
      beyondPct: dir === "long" ? (c.close - level) / level : (level - c.close) / level,
      volumeX,
      ageMin: Math.max(0, Math.floor((now - end) / MIN)),
      late: now - end > intervalMs,
    };
    break;
  }

  const stale = pendingAt != null ? `Die Kerze ${T(pendingAt)} ist laut Uhr geschlossen, die Daten halten sie noch nicht als geschlossen. Sie zählt, sobald sie nachgeladen ist (meist binnen einer Minute).` : null;
  const common = { range, last, forming, used: closedSlots.length, stale };

  if (signal) {
    const dirWord = signal.side === "long" ? "über dem Hoch" : "unter dem Tief";
    reasons.push(
      `Die Kerze ${T(signal.barOpen)} ist um ${T(signal.barClose)} Uhr geschlossen. Ihr Schluss ${P(signal.price)} liegt ${dirWord} der Range (${P(signal.level)}), ${num(signal.beyondPct * 100, 2)} % darüber hinaus.`,
      "Gezählt wird der Schluss der ersten geschlossenen Kerze nach der Range, nicht ein Docht und nicht ein Schluss genau auf dem Niveau.",
    );
    if (signal.volumeX != null) reasons.push(`Volumen der Kerze: ${num(signal.volumeX, 2)}× dem Range-Durchschnitt${i.minVolumeX ? ` (verlangt: ${num(i.minVolumeX, 2)}×)` : ""}.`);
    reasons.push(...skippedThin, ...skippedSide);
    reasons.push(past ? "Die Sitzung ist vorbei: Das ist ein Rückblick darauf, wie der Ablauf gewesen wäre." : signal.late ? `Das Signal ist ${signal.ageMin} Minuten alt – älter als eine Kerze. Ein später Einstieg ist ein anderer Trade.` : "Das Signal ist frisch (höchstens eine Kerze alt).");
    return done({
      ...common,
      status: "triggered",
      signal,
      headline: `Signal ${sideName(signal.side)}: Schluss ${P(signal.price)} um ${T(signal.barClose)} Uhr ${dirWord} der Range.`,
      reasons,
    });
  }

  if (gapAt != null) {
    return done({
      ...common,
      status: "no-data",
      headline: `Eine Kerze fehlt in den Daten (${T(gapAt)}).`,
      reasons: ["Ohne diese Kerze lässt sich nicht sicher sagen, wo der erste Schluss außerhalb der Range lag – die App rät nicht über die Lücke hinweg."],
    });
  }

  const expired = now >= session.cutoffMs && pendingAt == null;
  if (expired) {
    return done({
      ...common,
      status: "expired",
      headline: `Abgelaufen: bis ${T(session.cutoffMs)} Uhr ist keine Kerze außerhalb der Range geschlossen.`,
      reasons: [...skippedThin, ...skippedSide, `Nach ${T(session.cutoffMs)} Uhr${earlyNote} gibt es kein neues Signal; ohne Signal gibt es nach dieser Regel keinen Einstieg.`],
    });
  }

  // waiting: how far the last close is from each edge
  const short: string[] = [];
  if (last) {
    const toHigh = range.high - last.close;
    const toLow = last.close - range.low;
    const longPart = `${P(Math.abs(toHigh))} ${toHigh >= 0 ? "unter" : "über"} dem Range-Hoch`;
    const shortPart = `${P(Math.abs(toLow))} ${toLow >= 0 ? "über" : "unter"} dem Range-Tief`;
    if (i.sides !== "short") short.push(longPart);
    if (i.sides !== "long") short.push(shortPart);
    const full: string[] = [];
    if (i.sides !== "short") full.push(`${longPart} ${P(range.high)} (${signedPctText(last.close / range.high - 1)})`);
    if (i.sides !== "long") full.push(`${shortPart} ${P(range.low)} (${signedPctText(last.close / range.low - 1)})`);
    reasons.push(`Letzter Schluss ${P(last.close)} (Kerze ${T(last.time)}): ${full.join(" und ")}.`);
  } else {
    reasons.push("Nach der Range ist noch keine Kerze geschlossen.");
  }
  const fl = formingLine();
  if (fl) reasons.push(fl);
  reasons.push(...skippedThin, ...skippedSide);
  if (stale) reasons.push(stale);
  reasons.push("Gezählt wird nur der Schluss einer geschlossenen Kerze außerhalb der Range – ein Docht darüber hinaus löst nichts aus.", cutoffLine);
  return done({
    ...common,
    status: "waiting",
    headline: last ? `Warten: letzter Schluss ${P(last.close)}, ${short.join(" und ")}.` : "Warten auf die erste Kerze nach der Range.",
    reasons,
  });
}
