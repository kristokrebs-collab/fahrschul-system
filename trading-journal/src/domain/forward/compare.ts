/**
 * "Hält der Forward-Test, was der Rückblick zeigt?" (F23, pure). The forward test is compared with the backtest of the SAME
 * rules, costs and risk over the period BEFORE the start (`backtestWindow`), never with a period the account has already
 * traded. Every statement carries its numbers and its sample size; a difference is an observation, never a proven cause.
 */
import { runBacktest } from "../backtest/engine";
import { runStats, type RunStats } from "../backtest/metrics";
import { customStrategy, type CustomFacts } from "../backtest/strategies/custom";
import type { Prepared } from "../backtest/strategies/types";
import { HIST_MS, type EngineCfg, type RunResult } from "../backtest/types";
import type { ForwardAccount } from "./types";

/** Fewest trades on a side for a comparison to say more than "too early". */
export const COMPARE_MIN_TRADES = 10;
/** Look-back periods offered for the backtest (days). */
export const LOOKBACK_DAYS = [180, 365, 730] as const;
export type Lookback = (typeof LOOKBACK_DAYS)[number];

const DAY = 86_400_000;

const dec = (v: number, d: number): string => v.toFixed(d).replace(".", ",").replace("-", "−");
const rTxt = (v: number | null, d = 2): string => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${dec(v, d)} R`);
const pctTxt = (v: number | null, d = 1, sign = true): string => (v == null || !Number.isFinite(v) ? "–" : `${sign && v > 0 ? "+" : ""}${dec(v * 100, d)} %`);
const pfTxt = (v: number | null): string => (v == null ? "–" : v === Infinity ? "∞" : dec(v, 2));

/** The backtest of the account's rules over the `lookbackDays` before its start: the facts are prepared from `startMs - lookback` on. */
export function backtestWindow(account: ForwardAccount, prep: Prepared<CustomFacts>, engine: EngineCfg): RunResult | null {
  const secLen = HIST_MS[account.interval] / 1000;
  let to = prep.bars.length - 1;
  // only candles that had closed when the account started
  while (to > prep.start && (prep.bars[to]!.t + secLen) * 1000 > account.startMs) to--;
  if (!(to > prep.start)) return null;
  return runBacktest(prep.bars, customStrategy.build(prep, {}), engine, { from: prep.start, to, equity: true, atr: prep.atr, secLen });
}

export interface CompareRow {
  id: "n" | "rate" | "avgR" | "pf" | "net" | "dd";
  label: string;
  forward: string;
  backtest: string;
  /** forward minus backtest in words, null when a side has no value */
  diff: string | null;
  /** is the forward value inside the 80 % interval of the backtest? `null` = no interval to ask */
  inside: boolean | null;
  /** note on the row's uncertainty */
  hint?: string;
}

export interface ForwardCompare {
  level: "thin" | "holds" | "differs";
  headline: string;
  rows: CompareRow[];
  /** things to keep in mind, each a sentence */
  notes: string[];
  forwardN: number;
  backtestN: number;
  backtestDays: number;
}

/** Forward `fwd` against backtest `bt` (both `runStats`). */
export function compareForward(fwd: RunStats, bt: RunStats): ForwardCompare {
  const perMonth = (s: RunStats): number | null => (s.days >= 1 ? (s.n / s.days) * 30 : null);
  const fm = perMonth(fwd);
  const bm = perMonth(bt);
  const ci = (i: { lo: number; hi: number } | null, f: (v: number) => string): string => (i ? `${f(i.lo)} bis ${f(i.hi)}` : "kein Bereich");
  const inside = (v: number | null, i: { lo: number; hi: number } | null): boolean | null => (v == null || !i ? null : v >= i.lo && v <= i.hi);
  const rows: CompareRow[] = [
    {
      id: "n",
      label: "Trades",
      forward: `${fwd.n}${fm != null ? ` (${dec(fm, 1)} / 30 Tage)` : ""}`,
      backtest: `${bt.n}${bm != null ? ` (${dec(bm, 1)} / 30 Tage)` : ""}`,
      diff: fm != null && bm != null ? `${fm - bm >= 0 ? "+" : "−"}${dec(Math.abs(fm - bm), 1)} Trades / 30 Tage` : null,
      inside: null,
      hint: "Stichprobe: je weniger Trades, desto breiter streut jede Zahl darunter.",
    },
    {
      id: "rate",
      label: "Trefferquote",
      forward: `${pctTxt(fwd.winRate, 0, false)}${fwd.winRateCI ? ` (${ci(fwd.winRateCI, (v) => pctTxt(v, 0, false))})` : ""}`,
      backtest: `${pctTxt(bt.winRate, 0, false)}${bt.winRateCI ? ` (${ci(bt.winRateCI, (v) => pctTxt(v, 0, false))})` : ""}`,
      diff: fwd.winRate != null && bt.winRate != null ? `${fwd.winRate - bt.winRate >= 0 ? "+" : "−"}${dec(Math.abs(fwd.winRate - bt.winRate) * 100, 0)} Prozentpunkte` : null,
      inside: inside(fwd.winRate, bt.winRateCI),
      hint: "In Klammern der 80-%-Bereich (Wilson).",
    },
    {
      id: "avgR",
      label: "Ø R je Trade",
      forward: `${rTxt(fwd.avgR)}${fwd.rCI ? ` (${ci(fwd.rCI, (v) => rTxt(v))})` : ""}`,
      backtest: `${rTxt(bt.avgR)}${bt.rCI ? ` (${ci(bt.rCI, (v) => rTxt(v))})` : ""}`,
      diff: fwd.avgR != null && bt.avgR != null ? `${fwd.avgR - bt.avgR >= 0 ? "+" : "−"}${dec(Math.abs(fwd.avgR - bt.avgR), 2)} R` : null,
      inside: inside(fwd.avgR, bt.rCI),
      hint: "In Klammern der 80-%-Bereich des Mittelwerts (t-Intervall).",
    },
    {
      id: "pf",
      label: "Profitfaktor",
      forward: pfTxt(fwd.pf),
      backtest: pfTxt(bt.pf),
      diff: fwd.pf != null && bt.pf != null && Number.isFinite(fwd.pf) && Number.isFinite(bt.pf) ? `${fwd.pf - bt.pf >= 0 ? "+" : "−"}${dec(Math.abs(fwd.pf - bt.pf), 2)}` : null,
      inside: null,
    },
    {
      id: "net",
      label: "Ergebnis je 30 Tage",
      forward: fwd.days >= 1 ? pctTxt((fwd.netPct / fwd.days) * 30) : "–",
      backtest: bt.days >= 1 ? pctTxt((bt.netPct / bt.days) * 30) : "–",
      diff: fwd.days >= 1 && bt.days >= 1 ? `${fwd.netPct / fwd.days - bt.netPct / bt.days >= 0 ? "+" : "−"}${dec(Math.abs((fwd.netPct / fwd.days - bt.netPct / bt.days) * 30) * 100, 1)} Prozentpunkte` : null,
      inside: null,
      hint: "Auf 30 Tage umgerechnet, ohne Zinseszins; bei kurzen Zeiträumen kaum belastbar.",
    },
    {
      id: "dd",
      label: "Größter Rückgang",
      forward: pctTxt(-fwd.maxDD, 1),
      backtest: pctTxt(-bt.maxDD, 1),
      diff: null,
      inside: null,
      hint: "Forward: gemessen an den Trade-Enden und dem aktuellen Stand, ein Einbruch innerhalb eines Trades kann fehlen.",
    },
  ];
  const notes = [
    "Der Rückblick ist die Zeit VOR dem Start des Kontos, der Forward-Test die Zeit danach: dieselben Kerzen werden nie für beides benutzt.",
    "Regeln, die man nach einem Rückblick aufstellt oder anpasst, sehen den Rückblick schon. Ein schwächerer Forward-Test kann daher auch heißen, dass die Regeln dem Rückblick zu gut angepasst waren.",
  ];
  const base = { rows, notes, forwardN: fwd.n, backtestN: bt.n, backtestDays: Math.round(bt.days) };
  if (fwd.n < COMPARE_MIN_TRADES) {
    return { ...base, level: "thin", headline: `Zu früh für ein Urteil: Der Forward-Test hat erst ${fwd.n} Trade${fwd.n === 1 ? "" : "s"} (der Rückblick ${bt.n}). Unter ${COMPARE_MIN_TRADES} Trades kann jede Abweichung Zufall sein.` };
  }
  if (bt.n < COMPARE_MIN_TRADES) {
    return { ...base, level: "thin", headline: `Der Rückblick hat selbst nur ${bt.n} Trades. Damit lässt sich der Forward-Test (${fwd.n} Trades) nicht ernsthaft daran messen.` };
  }
  const rIn = inside(fwd.avgR, bt.rCI);
  if (rIn === true) {
    return { ...base, level: "holds", headline: `Bisher im Rahmen: Ø ${rTxt(fwd.avgR)} im Forward-Test liegt im 80-%-Bereich des Rückblicks (${ci(bt.rCI, (v) => rTxt(v))}; Rückblick Ø ${rTxt(bt.avgR)}, n = ${bt.n}). Das ist keine Bestätigung, nur keine Abweichung, die die Zahlen erkennen lassen.` };
  }
  const below = (fwd.avgR ?? 0) < (bt.avgR ?? 0);
  const why = [
    "Zufall bei kleiner Stichprobe (n = " + fwd.n + ")",
    "eine andere Marktphase als im Rückblick",
    "Kosten oder Ausführung, die schlechter als angenommen sind",
    "Regeln, die dem Rückblick zu gut angepasst waren",
  ];
  return {
    ...base,
    level: "differs",
    headline: `Abweichung: Ø ${rTxt(fwd.avgR)} im Forward-Test gegenüber Ø ${rTxt(bt.avgR)} im Rückblick, ${below ? "darunter" : "darüber"} und außerhalb des 80-%-Bereichs des Rückblicks (${ci(bt.rCI, (v) => rTxt(v))}). Mögliche Gründe, keiner davon geprüft: ${why.join("; ")}.`,
  };
}

/** Days of history before the start that the backtest asks for, with the warm-up (ms). */
export const lookbackMs = (days: Lookback): number => days * DAY;

/** The backtest window's stats (the same `runStats` the lab uses). */
export const backtestStats = (run: RunResult): RunStats => runStats(run);
