/**
 * Eröffnungs-Range-Ausbruch (ORB) – die zweite Familie der Strategiesuche, als reine Funktion „Sitzung → Range, Signal, Gründe, Note,
 * Ausführungsverlauf“ (auch für ein späteres Tages-Replay, Kerze für Kerze). Regeln (Konzept des Setup-Labor-Prototyps, hier neu
 * gebaut und gegen Handrechnungen getestet, `tests/unit/lab.orb.test.ts`):
 *
 *   Kerzen    5 Minuten, geschlossen; Sitzung New York 13:30–20:00 UTC, London 07:00–13:00 UTC (nur Werktage, UTC)
 *   Range     Hoch/Tief der ersten 15 / 30 / 60 Minuten der Sitzung
 *   Signal    die ERSTE Kerze, deren Schluss außerhalb der Range liegt – nur innerhalb von 3 Stunden nach dem Ende der Range
 *             (Schluss über dem Hoch = Long, unter dem Tief = Short); vorher gibt es keins, nachher auch nicht
 *   Gründe    Volumen der Ausbruchskerze ÷ Schnitt der 20 Kerzen DAVOR; Kurs (Schluss) auf der passenden Seite der EMA 50
 *   Note      A+ Volumen ≥ 2× und Trend passt · A Volumen ≥ Schwelle und Trend passt · B eins von beiden · C keins
 *   Filter    eine Variante handelt nur, wenn das Volumen ≥ ihrer Schwelle ist und (falls gewählt) der Trend passt
 *   Einstieg  zur Eröffnung der Folgekerze der Ausbruchskerze
 *   Stop      gegenüberliegende Seite der Range, Mitte der Range oder 1,5 × ATR(14) der Ausbruchskerze
 *   Ziel      R-Vielfaches des Abstands Einstieg–Stop
 *   Ausführung  je Kerze: zuerst eine Lücke über den Stop (Eröffnung jenseits des Stops → Füllung zur Eröffnung), dann der Stop (vor dem
 *             Ziel, auch wenn beides in einer Kerze liegt), dann das Ziel; Zeit-Stopp am Schluss der letzten Kerze der Sitzung
 *   Stop-Führung  fest / Einstand / Nachziehen (`StopRule`): am Schluss jeder Kerze ab der Einstiegskerze; hat der beste Kurs seit dem
 *             Einstieg +1 R erreicht, zieht „Einstand“ den Stop auf den Einstieg (nur wenn der Schluss schon darüber liegt), „Nachziehen“ auf
 *             bester Kurs − 1 R. Gültig ab der nächsten Kerze, nur enger (wie die Engine des Labors).
 *   Kosten    Gebühr Taker auf Einstieg, Stop und Zeit-Stopp, Maker auf das Ziel (Standard Binance 5 / 2 bp), Slippage gegen den Trader auf
 *             Market-Füllungen (das Ziel ist ein Limit). Funding ist hier NICHT eingerechnet (Sitzung ≤ 6,5 h, aber 16:00 UTC liegt in New York).
 *
 * Kein Blick in die Zukunft: eine Entscheidung auf der Kerze j nutzt nur Kerzen bis j (Range = Kerzen davor, Volumenschnitt = 20 davor,
 * EMA/ATR rekursiv); gefüllt wird erst zur Eröffnung von j + 1.
 */
import { ema } from "@/domain/signals";
import { atrSeries } from "@/domain/backtest/bars";
import { slipped } from "@/domain/backtest/slippage";
import type { Bar, SlippageModel } from "@/domain/backtest/types";
import type { StopRule } from "./types";

export type OrbSessionId = "ny" | "london";
export type OrbStop = "range" | "mid" | "atr15";

export const ORB_BAR_MS = 300_000;
const DAY = 86_400_000;
const H = 3_600_000;

export const ORB_SESSIONS: Readonly<Record<OrbSessionId, { name: string; open: number; end: number }>> = {
  ny: { name: "New York", open: 13.5 * H, end: 20 * H },
  london: { name: "London", open: 7 * H, end: 13 * H },
};

/** Suchraum der Familie: 2 Sitzungen × 3 Ranges × 3 Volumen-Schwellen × 5 Ziele × 3 Stops × 2 Trendfilter = 540 Varianten (alle werden geprüft). */
export const ORB_SPACE = {
  session: ["ny", "london"] as const,
  rangeMin: [15, 30, 60] as const,
  volThr: [1.25, 1.5, 2] as const,
  targetR: [1, 1.5, 2, 2.5, 3] as const,
  stop: ["range", "mid", "atr15"] as const,
  trend: [false, true] as const,
};

/** Nach dem Ende der Range darf das Signal höchstens so viele 5-Minuten-Kerzen später kommen (3 Stunden). */
export const ORB_SIGNAL_BARS = 36;
export const ORB_VOL_LOOKBACK = 20;
export const ORB_EMA = 50;

export interface OrbParams {
  session: OrbSessionId;
  rangeMin: number;
  volThr: number;
  targetR: number;
  stop: OrbStop;
  trend: boolean;
  /** Stop-Führung nach dem Einstieg (Standard: fest) */
  manage?: StopRule;
}

export interface OrbCosts {
  takerBps: number;
  makerBps: number;
  slippage: SlippageModel;
}

/** Vorberechnete Reihen über alle Kerzen (rekursiv bzw. nur aus Kerzen davor). */
export interface OrbPrep {
  bars: readonly Bar[];
  n: number;
  atr: readonly number[];
  ema: readonly number[];
  /** Schnitt des Volumens der 20 Kerzen VOR der Kerze i */
  vma: Float64Array;
  /** Eröffnungszeit (ms) → Index */
  idx: Map<number, number>;
}

export function orbPrepare(bars: readonly Bar[]): OrbPrep {
  const n = bars.length;
  const vma = new Float64Array(n);
  const idx = new Map<number, number>();
  let vs = 0;
  for (let j = 0; j < n; j++) {
    const v = bars[j]!.v ?? 0;
    vma[j] = j >= ORB_VOL_LOOKBACK ? vs / ORB_VOL_LOOKBACK : j ? vs / j : v;
    vs += v;
    if (j >= ORB_VOL_LOOKBACK) vs -= bars[j - ORB_VOL_LOOKBACK]!.v ?? 0;
    idx.set(bars[j]!.t * 1000, j);
  }
  return { bars, n, atr: atrSeries(bars), ema: ema(bars.map((b) => b.c), ORB_EMA), vma, idx };
}

/** Werktage (UTC-Tagesnummern), an denen die Sitzung eine Eröffnungskerze in den Daten hat. */
export function orbDays(prep: OrbPrep, session: OrbSessionId): number[] {
  const out: number[] = [];
  if (!prep.n) return out;
  const first = Math.floor(prep.bars[0]!.t * 1000 / DAY);
  const last = Math.floor(prep.bars[prep.n - 1]!.t * 1000 / DAY);
  for (let d = first; d <= last; d++) {
    const wd = new Date(d * DAY).getUTCDay();
    if (wd > 0 && wd < 6 && prep.idx.has(d * DAY + ORB_SESSIONS[session].open)) out.push(d);
  }
  return out;
}

export type OrbNote = "A+" | "A" | "B" | "C";

export function orbNote(volFactor: number, trendOk: boolean, thr: number): OrbNote {
  if (volFactor >= 2 && trendOk) return "A+";
  if (volFactor >= thr && trendOk) return "A";
  if (volFactor >= thr || trendOk) return "B";
  return "C";
}

/** Range, Signal und Gründe eines Tages – unabhängig von Stop, Ziel und Filtern (die Variante entscheidet danach). */
export interface OrbDetect {
  day: number;
  session: OrbSessionId;
  rangeMin: number;
  /** Index der ersten Kerze der Sitzung / der ersten nach der Range / der letzten der Sitzung */
  i0: number;
  iRangeEnd: number;
  iEnd: number;
  high: number;
  low: number;
  /** die Range ist vollständig abgeschlossen (alle ihre Kerzen sind da) */
  rangeDone: boolean;
  signal: { j: number; dir: 1 | -1; time: number } | null;
  /** Volumen der Ausbruchskerze ÷ Schnitt der 20 davor; Kurs auf der passenden Seite der EMA 50; Ausbruch in ATR */
  volFactor: number | null;
  trendOk: boolean | null;
  breakAtr: number | null;
  atr: number | null;
}

export function orbDetect(prep: OrbPrep, day: number, session: OrbSessionId, rangeMin: number): OrbDetect | null {
  const S = ORB_SESSIONS[session];
  const i0 = prep.idx.get(day * DAY + S.open);
  if (i0 == null) return null;
  const n = rangeMin / 5;
  const iEnd = i0 + (S.end - S.open) / ORB_BAR_MS - 1;
  if (i0 + n > prep.n) return null; // die Range ist nicht abgeschlossen
  let high = -Infinity;
  let low = Infinity;
  for (let i = i0; i < i0 + n; i++) {
    high = Math.max(high, prep.bars[i]!.h);
    low = Math.min(low, prep.bars[i]!.l);
  }
  const lim = Math.min(iEnd - 1, i0 + n + ORB_SIGNAL_BARS - 1, prep.n - 1);
  let signal: OrbDetect["signal"] = null;
  for (let j = i0 + n; j <= lim; j++) {
    const c = prep.bars[j]!.c;
    if (c > high) signal = { j, dir: 1, time: prep.bars[j]!.t * 1000 };
    else if (c < low) signal = { j, dir: -1, time: prep.bars[j]!.t * 1000 };
    if (signal) break;
  }
  const d: OrbDetect = { day, session, rangeMin, i0, iRangeEnd: i0 + n - 1, iEnd, high, low, rangeDone: true, signal, volFactor: null, trendOk: null, breakAtr: null, atr: prep.atr[i0 + n - 1] ?? null };
  if (signal) {
    const j = signal.j;
    const c = prep.bars[j]!.c;
    d.volFactor = prep.vma[j]! > 0 ? (prep.bars[j]!.v ?? 0) / prep.vma[j]! : null;
    d.trendOk = signal.dir > 0 ? c > prep.ema[j]! : c < prep.ema[j]!;
    d.breakAtr = ((signal.dir > 0 ? c - high : low - c) / prep.atr[j]!) || null;
  }
  return d;
}

export type OrbExit = "target" | "stop" | "gap" | "time";

export type OrbTrade =
  | { state: "pending" }
  | { state: "open"; entry: number; stop: number; target: number; risk: number; j: number; dir: 1 | -1; path: number[]; kLast: number }
  | {
      state: "closed";
      dir: 1 | -1;
      j: number;
      /** Eröffnung der Folgekerze, auf der gefüllt wurde (Bezugspreis ohne Slippage) */
      entry: number;
      stop: number;
      target: number;
      /** Abstand Einstieg–Stop */
      risk: number;
      exit: number;
      exitKind: OrbExit;
      /** Index der Kerze des Ausstiegs */
      kExit: number;
      /** Ergebnis in R nach Gebühren und Slippage; `costR` davon an Kosten */
      r: number;
      costR: number;
      /** R am Schluss jeder Kerze ab der Einstiegskerze, am Ende der Endwert vor Kosten – für ein Replay */
      path: number[];
    };

/** Einstieg zur Eröffnung der Folgekerze, Ausführung Kerze für Kerze. `null` = nicht handelbar (Stop auf der falschen Seite). */
export function orbTrade(prep: OrbPrep, d: OrbDetect, stopRule: OrbStop, targetR: number, costs: OrbCosts, manage: StopRule = "fixed"): OrbTrade | null {
  if (!d.signal) return null;
  const { j, dir } = d.signal;
  if (j + 1 >= prep.n) return { state: "pending" };
  const b = prep.bars;
  const e = b[j + 1]!.o;
  const stop0 = stopRule === "range" ? (dir > 0 ? d.low : d.high) : stopRule === "mid" ? (d.high + d.low) / 2 : e - dir * 1.5 * prep.atr[j]!;
  let stop = stop0;
  const risk = (e - stop0) * dir;
  if (!(risk > 0)) return null;
  const target = e + dir * targetR * risk;
  const path: number[] = [];
  const slip = costs.slippage;
  const atrAt = prep.atr[j] ?? null;
  const taker = costs.takerBps / 10_000;
  const maker = costs.makerBps / 10_000;
  let exit = 0;
  let kind: OrbExit | null = null;
  let k = j + 1;
  let peak = e;
  for (; k <= d.iEnd && k < prep.n; k++) {
    // Lücke über den Stop: die Kerze eröffnet jenseits des Stops – Füllung zur Eröffnung (auf der Einstiegskerze ist das der Einstieg selbst)
    if (k > j + 1 && (b[k]!.o - stop) * dir <= 0) {
      exit = b[k]!.o;
      kind = "gap";
      break;
    }
    const adverse = dir > 0 ? b[k]!.l : b[k]!.h;
    const favour = dir > 0 ? b[k]!.h : b[k]!.l;
    if ((adverse - stop) * dir <= 0) {
      exit = stop;
      kind = "stop";
      break;
    }
    if ((favour - target) * dir >= 0) {
      exit = target;
      kind = "target";
      break;
    }
    path.push(((b[k]!.c - e) * dir) / risk);
    // Stop-Führung am Schluss dieser Kerze, gültig ab der nächsten; der Stop wird nur enger
    if (manage !== "fixed") {
      peak = dir > 0 ? Math.max(peak, b[k]!.h) : Math.min(peak, b[k]!.l);
      if ((peak - e) * dir >= risk) {
        const lvl = manage === "be" ? e : peak - dir * risk;
        const behindClose = (b[k]!.c - lvl) * dir > 0;
        if ((lvl - stop) * dir > 0 && (manage === "trail" || behindClose)) stop = lvl;
      }
    }
  }
  if (!kind) {
    if (k > d.iEnd) {
      exit = b[d.iEnd]!.c;
      kind = "time";
      k = d.iEnd;
    } else return { state: "open", entry: e, stop, target, risk, j, dir, path, kLast: k - 1 };
  }
  // Füllpreise mit Slippage gegen den Trader (Market: Einstieg, Stop, Lücke, Zeit-Stopp; das Ziel ist ein Limit)
  const entryFill = slipped(slip, e, dir > 0, atrAt);
  const exitFill = kind === "target" ? exit : slipped(slip, exit, dir < 0, atrAt);
  const fee = entryFill * taker + exitFill * (kind === "target" ? maker : taker);
  const costR = (fee + Math.abs(entryFill - e) + (kind === "target" ? 0 : Math.abs(exitFill - exit))) / risk;
  const net = ((exitFill - entryFill) * dir - fee) / risk;
  path.push(((exit - e) * dir) / risk);
  return { state: "closed", dir, j, entry: e, stop: stop0, target, risk, exit, exitKind: kind, kExit: k, r: net, costR, path };
}

/** Alles zu einer Sitzung auf einmal – für die Suche, den Kandidaten und ein späteres Replay. */
export interface OrbSession {
  detect: OrbDetect | null;
  /** die Variante handelt diesen Tag (Signal, Volumen ≥ Schwelle, Trend falls gefordert) */
  counts: boolean;
  note: OrbNote | null;
  trade: OrbTrade | null;
}

export function orbSession(prep: OrbPrep, day: number, p: OrbParams, costs: OrbCosts): OrbSession {
  const detect = orbDetect(prep, day, p.session, p.rangeMin);
  if (!detect?.signal) return { detect, counts: false, note: null, trade: null };
  const vf = detect.volFactor ?? 0;
  const tr = detect.trendOk === true;
  const counts = vf >= p.volThr && (!p.trend || tr);
  return { detect, counts, note: orbNote(vf, tr, p.volThr), trade: counts ? orbTrade(prep, detect, p.stop, p.targetR, costs, p.manage ?? "fixed") : null };
}

/** Kosten-Modell der Familie aus dem Engine-Modell des Labors (Gebühren und Slippage). */
export const orbCostsOf = (fees: { takerBps: number; makerBps: number }, slippage: SlippageModel): OrbCosts => ({ takerBps: fees.takerBps, makerBps: fees.makerBps, slippage });

