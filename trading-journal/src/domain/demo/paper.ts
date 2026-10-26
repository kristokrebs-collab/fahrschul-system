/**
 * Das Demokonto der Demo (F58): EIN Paper-Trade im Spiel. Du wählst Richtung, Stop (Vielfaches der ATR) und Ziel (Vielfaches des
 * Risikos), die Kerzen danach werden Stück für Stück aufgedeckt – und was passiert, entscheidet dieselbe Engine wie im Backtest und im
 * virtuellen Konto (`runBacktest` mit `keepOpen`): Einstieg zur Eröffnung der nächsten Kerze, Stop vor Ziel, wenn eine Kerze beides
 * berührt, Gebühren und Slippage. Bei jeder aufgedeckten Kerze wird neu gerechnet, nie vorausgeschaut (die Reihe wird bis zur
 * aufgedeckten Kerze abgeschnitten). Es gibt keinen Weg zu einer Börse; „eröffnen“ heißt hier: im Spiel mitrechnen.
 */
import { atrSeries } from "../backtest/bars";
import { runBacktest } from "../backtest/engine";
import type { BtSide, BtStrategy, BtTrade, EngineCfg, EntrySignal } from "../backtest/types";
import { DEFAULT_FEES } from "../backtest/fees";
import { demoHourly } from "./candles";

/** Das Spielkonto: 1 000 Einheiten, 1 % Risiko = 10 je Trade. */
export const PAPER_ENGINE: EngineCfg = {
  capital: 1000,
  riskPct: 0.01,
  maxLeverage: 5,
  compounding: false,
  costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "none" } },
};

/** Kerze, an deren Schluss entschieden wird (Index in den 1h-Beispiel-Kerzen). */
export const PAPER_SCENE = 1500;
/** Wie viele Kerzen vor der Entscheidung gezeigt werden. */
export const PAPER_LOOKBACK = 90;
/** Höchstens so viele Kerzen nach dem Einstieg werden aufgedeckt. */
export const PAPER_MAX_AFTER = 160;

export interface PaperPlan {
  side: BtSide;
  /** Stop als Vielfaches der ATR(14) */
  stopAtr: 1 | 1.5 | 2;
  /** Ziel als Vielfaches des Risikos */
  targetR: 1 | 2 | 3;
}

export const DEFAULT_PAPER: PaperPlan = { side: "long", stopAtr: 1.5, targetR: 2 };

export interface PaperLevels {
  /** Schluss der Entscheidungskerze (der Einstieg wird zur nächsten Eröffnung gefüllt) */
  close: number;
  stop: number;
  target: number;
  /** Abstand zum Stop = das Risiko je Einheit */
  risk: number;
  atr: number;
}

export type PaperState = "waiting" | "open" | "closed";

export interface PaperView {
  state: PaperState;
  /** aufgedeckte Kerzen nach der Entscheidung (0 = noch keine) */
  shown: number;
  /** Index der letzten sichtbaren Kerze */
  lastIndex: number;
  levels: PaperLevels;
  trade: BtTrade | null;
  /** offene Position: Einstieg, Menge, aktueller Kurs, offenes Ergebnis in R */
  open: { entry: number; qty: number; price: number; r: number } | null;
}

function levelsOf(plan: PaperPlan): PaperLevels {
  const bars = demoHourly();
  const atr = atrSeries(bars.slice(0, PAPER_SCENE + 1))[PAPER_SCENE]!;
  const close = bars[PAPER_SCENE]!.c;
  const risk = atr * plan.stopAtr;
  const dir = plan.side === "long" ? 1 : -1;
  return { close, stop: close - dir * risk, target: close + dir * risk * plan.targetR, risk, atr };
}

/** Die Strategie des Spiels: genau ein Signal, an der Entscheidungskerze. */
function oneShot(plan: PaperPlan, lv: PaperLevels): BtStrategy {
  const sig: EntrySignal = { side: plan.side, stop: lv.stop, target: lv.target, maxBars: null, tag: "Demokonto" };
  return { start: PAPER_SCENE, signalAt: (i) => (i === PAPER_SCENE ? sig : null) };
}

/** Der Stand des Spiels nach `shown` aufgedeckten Kerzen (0 … `PAPER_MAX_AFTER`). */
export function playPaper(plan: PaperPlan, shown: number): PaperView {
  const all = demoHourly();
  const k = Math.max(0, Math.min(PAPER_MAX_AFTER, Math.round(shown)));
  const last = PAPER_SCENE + k;
  const lv = levelsOf(plan);
  // nur Kerzen bis zur aufgedeckten: die Engine kann nicht weiter sehen
  const bars = all.slice(0, last + 1);
  const run = runBacktest(bars, oneShot(plan, lv), PAPER_ENGINE, { from: PAPER_SCENE, to: last, atr: atrSeries(bars), secLen: 3600, keepOpen: true, equity: false });
  const trade = run.trades[0] ?? null;
  if (trade) return { state: "closed", shown: k, lastIndex: last, levels: lv, trade, open: null };
  const pos = run.carry?.pos ?? null;
  if (pos) {
    const price = bars[last]!.c;
    const dir = plan.side === "long" ? 1 : -1;
    const riskPerUnit = Math.abs(pos.entry - (pos.stop0 ?? lv.stop));
    return { state: "open", shown: k, lastIndex: last, levels: lv, trade: null, open: { entry: pos.entry, qty: pos.qty, price, r: riskPerUnit > 0 ? (dir * (price - pos.entry)) / riskPerUnit : 0 } };
  }
  return { state: "waiting", shown: k, lastIndex: last, levels: lv, trade: null, open: null };
}

/** Wie das Spiel endet, in einem Satz (mit den Zahlen des Trades). */
export function paperVerdict(v: PaperView): string {
  const t = v.trade;
  if (!t) return v.state === "open" ? "Die Position läuft noch – decke die nächste Kerze auf." : "Der Einstieg wartet auf die Eröffnung der nächsten Kerze.";
  const why = t.reason === "target" ? "Das Ziel wurde erreicht" : t.reason === "stop" ? "Der Stop wurde erreicht" : t.reason === "end" ? "Das Spiel endete" : "Die Position wurde geschlossen";
  const r = (Math.round(t.r * 100) / 100).toString().replace(".", ",");
  const sign = t.r > 0 ? "+" : "";
  return `${why} nach ${t.bars} ${t.bars === 1 ? "Kerze" : "Kerzen"}: ${sign}${r} R, nach Gebühren und Slippage.`;
}
