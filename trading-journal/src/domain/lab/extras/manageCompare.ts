/**
 * Verwaltungsvergleich (F65 „Laborvergleich“): derselbe Lauf – gleiche Kerzen, Signale, Stops, Ziele, Kosten und Zeitraum –, nur
 * die Verwaltung nach dem Einstieg wechselt: Stop unverändert · Break-even nach +0,5 / +1 / +1,5 R · Break-even auf Netto ·
 * Trailing · Teilziel mit Break-even. Die Signale (Zeitpunkt, Richtung, Stop, Ziel) bleiben, nur `EntrySignal.manage` wird
 * ersetzt; entschieden wird wie im Lauf am Kerzenschluss, wirksam ab der nächsten Kerze (Engine, F65).
 *
 * Kennzahlen nach dem Bauplan, nicht nur die Trefferquote: Ø und Median R nach Kosten, Drawdown, Netto, Kosten, gebundene Zeit,
 * längste Verlustserie und „Ausstopper vor dem späteren Ziel“: Trades, die der verschobene Stop beendete, obwohl derselbe Trade
 * ohne Verwaltung das Ziel erreichte (Paarung über Einstiegszeit und Richtung). Eine Verwaltung ändert auch, WANN die Position
 * frei wird und damit, welche Signale handelbar sind – die Trades sind darum nicht in jeder Variante dieselben (die Zahl steht da).
 *
 * Nichts davon empfiehlt eine Einstellung: acht Varianten sind acht Versuche; die beste davon zu wählen wäre Anpassung an die
 * Vergangenheit. Die Seite sagt das dazu.
 */
import { runBacktest } from "../../backtest/engine";
import type { Window } from "../../backtest/optimize";
import type { LabStrategy, Params, Prepared } from "../../backtest/strategies/types";
import { HIST_MS, type BtStrategy, type BtTrade, type EngineCfg, type EntrySignal, type PositionMgmt, type RunResult } from "../../backtest/types";
import { statsOf } from "../stress/run";
import type { ScenarioStats } from "../stress/types";

export const MANAGE_COMPARE_VERSION = 1 as const;

export type ManageVariantId = "asRun" | "none" | "be05" | "be1" | "be15" | "be1net" | "trail2" | "trail3" | "partial";

export interface ManageVariantDef {
  id: ManageVariantId;
  label: string;
  /** what the rule does, in one sentence */
  detail: string;
  /** the management handed to every signal; `null` = none (stop and target as they were) */
  mgmt: PositionMgmt | null;
}

/** The variants of the comparison in the order of the table (`asRun` is added in front only when the run itself manages its trades). */
export const MANAGE_VARIANTS: readonly ManageVariantDef[] = [
  { id: "none", label: "Stop unverändert", detail: "Keine Verwaltung: der erste Stop und das Ziel bleiben, wie sie waren.", mgmt: null },
  { id: "be05", label: "Break-even nach +0,5 R", detail: "Hat der Kurs +0,5 R erreicht, rückt der Stop auf den Einstieg.", mgmt: { breakEven: { after: { kind: "r", value: 0.5 }, to: "entry" } } },
  { id: "be1", label: "Break-even nach +1 R", detail: "Hat der Kurs +1 R erreicht, rückt der Stop auf den Einstieg.", mgmt: { breakEven: { after: { kind: "r", value: 1 }, to: "entry" } } },
  { id: "be15", label: "Break-even nach +1,5 R", detail: "Hat der Kurs +1,5 R erreicht, rückt der Stop auf den Einstieg.", mgmt: { breakEven: { after: { kind: "r", value: 1.5 }, to: "entry" } } },
  { id: "be1net", label: "Netto-Break-even nach +1 R", detail: "Nach +1 R rückt der Stop auf den Preis, bei dem die Gebühren und die Slippage gedeckt sind (nicht nur auf den Einstieg).", mgmt: { breakEven: { after: { kind: "r", value: 1 }, to: "net" } } },
  { id: "trail2", label: "Trailing 2 × ATR ab +1 R", detail: "Ab +1 R folgt der Stop dem besten Kurs im Abstand von 2 ATR – nur in Gewinnrichtung.", mgmt: { trail: { kind: "atr", value: 2, activateR: 1 } } },
  { id: "trail3", label: "Trailing 3 × ATR ab +1 R", detail: "Ab +1 R folgt der Stop dem besten Kurs im Abstand von 3 ATR – nur in Gewinnrichtung.", mgmt: { trail: { kind: "atr", value: 3, activateR: 1 } } },
  { id: "partial", label: "Teilziel 50 % bei +1 R, dann Break-even", detail: "Die Hälfte wird bei +1 R mit Limit-Order verkauft, der Rest läuft mit dem Stop auf dem Einstieg weiter.", mgmt: { partial: { atR: 1, frac: 0.5, thenBreakEven: true } } },
];

const AS_RUN: ManageVariantDef = { id: "asRun", label: "Wie im gezeigten Lauf", detail: "Die Verwaltung, die deine Idee im Lauf oben hatte.", mgmt: null };

/** One more number than the stress rows have: what a management changes besides the sum. */
export interface ManageStats extends ScenarioStats {
  medianR: number | null;
  /** mean number of candles a trade was open */
  avgBars: number | null;
  /** fees + funding + slippage in money */
  costs: number;
  /** longest run of losing trades */
  longestLosing: number;
  /** trades ended by a moved stop (break-even or trailing) */
  movedOut: number;
  /** trades with a partial take-profit fill */
  partials: number;
  /** trades on which the management changed anything (a moved stop ended them or a partial was taken) */
  acted: number;
  /** trades where the stop and a take-profit lay in one candle – the engine assumed the stop */
  ambiguous: number;
}

export interface ManageRow {
  id: ManageVariantId;
  label: string;
  detail: string;
  stats: ManageStats | null;
  /** of the trades a moved stop ended: how many had a twin without management and how many of these twins reached their target */
  movedTwins: number | null;
  stoppedBeforeTarget: number | null;
  /** change against "Stop unverändert" (null for that row) */
  dSumR: number | null;
  dMedianR: number | null;
  dMaxDD: number | null;
}

export interface ManageCompare {
  v: typeof MANAGE_COMPARE_VERSION;
  /** length of one candle (ms) – for "gebundene Zeit" */
  barMs: number;
  rows: ManageRow[];
}

const finite = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

export function medianOf(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The strategy with the signals' management replaced (`null` = none): stop, target and timing stay, only `manage` changes. */
export function managed(inner: BtStrategy, mgmt: PositionMgmt | null): BtStrategy {
  return {
    start: inner.start,
    exitAt: inner.exitAt,
    signalAt(i: number): EntrySignal | null {
      const s = inner.signalAt(i);
      if (!s) return null;
      const { manage: _old, ...rest } = s;
      void _old;
      return mgmt ? { ...rest, manage: mgmt } : rest;
    },
  };
}

/** The strategy unchanged, counting the signals that carry a management of their own (`seen.managed`). */
export function counted(inner: BtStrategy, seen: { managed: number }): BtStrategy {
  return {
    start: inner.start,
    exitAt: inner.exitAt,
    signalAt(i: number): EntrySignal | null {
      const s = inner.signalAt(i);
      if (s?.manage) seen.managed++;
      return s;
    },
  };
}

function longest(trades: readonly BtTrade[]): number {
  let best = 0;
  let cur = 0;
  for (const t of trades) {
    if (t.pnl < 0) best = Math.max(best, ++cur);
    else cur = 0;
  }
  return best;
}

/** The numbers of one run. */
export function manageStatsOf(run: RunResult): ManageStats {
  const base = statsOf(run);
  const ts = run.trades;
  const movedOut = ts.filter((t) => t.reason === "breakeven" || t.reason === "trail").length;
  const partials = ts.filter((t) => (t.partials?.length ?? 0) > 0).length;
  return {
    ...base,
    medianR: medianOf(ts.map((t) => t.r).filter(finite)),
    avgBars: ts.length ? ts.reduce((a, t) => a + t.bars, 0) / ts.length : null,
    costs: ts.reduce((a, t) => a + t.fees + t.funding + t.slippage, 0),
    longestLosing: longest(ts),
    movedOut,
    partials,
    acted: ts.filter((t) => t.reason === "breakeven" || t.reason === "trail" || (t.partials?.length ?? 0) > 0).length,
    ambiguous: ts.filter((t) => t.ambiguous).length,
  };
}

const twinKey = (t: Pick<BtTrade, "entryTime" | "side">): string => `${t.entryTime}|${t.side}`;

/** One unit of work per variant (the run as it was + the variants); `result()` assembles the table from what is done. */
export function manageUnits<F>(
  strategy: LabStrategy<F, unknown>,
  prep: Prepared<F>,
  params: Params,
  engine: EngineCfg,
  win: Window,
  windowOk: boolean,
): { count: number; run(i: number): void; result(): ManageCompare } {
  const defs: ManageVariantDef[] = [AS_RUN, ...MANAGE_VARIANTS];
  const secLen = HIST_MS[prep.interval] / 1000;
  const stats = new Map<ManageVariantId, ManageStats>();
  const trades = new Map<ManageVariantId, BtTrade[]>();
  const seen = { managed: 0 };

  const run = (i: number): void => {
    const d = defs[i]!;
    if (!windowOk) return;
    const inner = strategy.build(prep, params);
    const use = d.id === "asRun" ? counted(inner, seen) : managed(inner, d.mgmt);
    const r = runBacktest(prep.bars, use, engine, { from: win.from, to: win.to, equity: true, atr: prep.atr, secLen });
    stats.set(d.id, manageStatsOf(r));
    trades.set(d.id, r.trades);
  };

  const result = (): ManageCompare => {
    const none = stats.get("none") ?? null;
    const noneTwins = new Map((trades.get("none") ?? []).map((t) => [twinKey(t), t] as const));
    const rows: ManageRow[] = [];
    for (const d of defs) {
      if (d.id === "asRun" && seen.managed === 0) continue; // the run had no management: it IS "Stop unverändert"
      const st = stats.get(d.id) ?? null;
      let twins: number | null = null;
      let before: number | null = null;
      if (st && d.id !== "none" && noneTwins.size) {
        twins = 0;
        before = 0;
        for (const t of trades.get(d.id) ?? []) {
          if (t.reason !== "breakeven" && t.reason !== "trail") continue;
          const w = noneTwins.get(twinKey(t));
          if (!w) continue;
          twins++;
          if (w.reason === "target") before++;
        }
      }
      const cmp = st && none && d.id !== "none";
      rows.push({
        id: d.id,
        label: d.label,
        detail: d.detail,
        stats: st,
        movedTwins: twins,
        stoppedBeforeTarget: before,
        dSumR: cmp ? st.sumR - none.sumR : null,
        dMedianR: cmp && finite(st.medianR) && finite(none.medianR) ? st.medianR - none.medianR : null,
        dMaxDD: cmp ? st.maxDD - none.maxDD : null,
      });
    }
    return { v: MANAGE_COMPARE_VERSION, barMs: HIST_MS[prep.interval], rows };
  };
  return { count: defs.length, run, result };
}
