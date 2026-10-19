/**
 * Backtest comparison – bundle card `bhe` (48001–48204) + explainer `h2` (23619) as pure data.
 * Compares leverage-free price moves per trade with the backtest reference.
 */
import type { BacktestReference, EnrichedTrade, Settings } from "./types";
import { aggregate, type Agg } from "./agg";
import { n1, n2, pct, pct0, signed } from "@/lib/format";
import { BACKTEST_SETUP_ID } from "./defaults";
import { ED } from "./edition";
import type { Explanation, Verdict } from "./explain";

export type BacktestRowKey = "winRate" | "avgWin" | "avgLoss" | "exp";
export type BacktestScope = "all" | "bt";

export interface BacktestRow {
  key: BacktestRowKey;
  /** "Win-Rate" | "Ø Gewinner" | "Ø Verlierer" | "Erwartung pro Trade" */
  l: string;
  you: number | null;
  ref: number;
  kind: "pp" | "pct";
  /** you − ref, better when ≥ 0 for ALL rows */
  delta: number | null;
  /** formatted cells */
  youText: string;
  refText: string;
  /** "–" | "▲ 1,2" | "▼ 3,4" */
  deltaText: string;
  tone: "win" | "loss" | "mute";
}

export interface BacktestCompare {
  scope: BacktestScope;
  stats: Agg;
  rows: BacktestRow[];
  headlineDelta: number | null;
  status: "over" | "under" | null;
  headline: string;
  sub: string;
  /** "ab 30 Trades belastbar" when 0 < moveN < 30 */
  warnBadge: string | null;
  footer: string;
}

export const BACKTEST_CARD_TITLE = "Backtest-Vergleich";
export const BACKTEST_SCOPE_ALL = "Alle Trades";
export const BACKTEST_SCOPE_BT = "Nur Backtest-Signal";
export const BACKTEST_COLUMNS = ["Kennzahl", "Du", "Backtest", "Δ"] as const;
export const BACKTEST_FOOTER =
  "Gewinner, Verlierer und Erwartung als Kursbewegung vom Einstieg zum Ausstieg, ohne Hebel, wie im Backtest.";
export const BACKTEST_WARN_BADGE = "ab 30 Trades belastbar";
export const BACKTEST_HEADLINE_OVER = "Du überperformst den Backtest";
export const BACKTEST_HEADLINE_UNDER = "Du liegst unter dem Backtest";
export const BACKTEST_HEADLINE_NONE = "Noch kein Vergleich möglich";
/** Decision 14: shown when `s_bt` was deleted by the user. */
export const BACKTEST_SETUP_DELETED: string = ED.COPY.backtestDeleted;

const ROW_LABELS: Record<BacktestRowKey, string> = {
  winRate: "Win-Rate",
  avgWin: "Ø Gewinner",
  avgLoss: "Ø Verlierer",
  exp: "Erwartung pro Trade",
};

const WHAT: Record<BacktestRowKey, string> = {
  winRate: "Anteil gewonnener Trades, verglichen mit den 214 Backtest-Signalen.",
  avgWin:
    "Durchschnittliche Kursbewegung vom Einstieg zum Ausstieg bei gewonnenen Trades, ohne Hebel. So ist auch der Backtest gerechnet.",
  avgLoss:
    "Durchschnittliche Kursbewegung bei verlorenen Trades, ohne Hebel. Ein kleinerer Wert als im Backtest heißt: du schneidest Verluste früher ab.",
  exp: "Durchschnittliche Kursbewegung über alle Trades. Das ist die Zahl, an der sich Über- oder Unterperformance entscheidet.",
};

const youOf = (key: BacktestRowKey, s: Agg): number | null =>
  ({ winRate: s.winRate, avgWin: s.moveWin, avgLoss: s.moveLoss, exp: s.moveExp })[key];
const refOf = (key: BacktestRowKey, bt: BacktestReference): number =>
  ({ winRate: bt.winRate, avgWin: bt.avgWin, avgLoss: bt.avgLoss, exp: bt.expectancy })[key];

/** Whether the "Nur Backtest-Signal" toggle can be shown (setup `s_bt` still exists). */
export function hasBacktestSetup(s: Pick<Settings, "setups">): boolean {
  return s.setups.some((x) => x.id === BACKTEST_SETUP_ID);
}

export function isBacktestTrade(t: Pick<EnrichedTrade, "setups">): boolean {
  return (t.setups || []).includes(BACKTEST_SETUP_ID);
}

export function backtestCompare(closed: readonly EnrichedTrade[], bt: BacktestReference, scope: BacktestScope = "all"): BacktestCompare {
  const subset = scope === "bt" ? closed.filter(isBacktestTrade) : closed;
  const stats = aggregate(subset);
  const rows: BacktestRow[] = (["winRate", "avgWin", "avgLoss", "exp"] as const).map((key) => {
    const kind = key === "winRate" ? "pp" : "pct";
    const you = youOf(key, stats);
    const ref = refOf(key, bt);
    const delta = you == null ? null : you - ref;
    return {
      key,
      l: ROW_LABELS[key],
      you,
      ref,
      kind,
      delta,
      youText: kind === "pp" ? pct0(you) : pct(you),
      refText: kind === "pp" ? n2(ref * 100) + " %" : pct(ref),
      deltaText: delta == null ? "–" : (delta >= 0 ? "▲ " : "▼ ") + n1(Math.abs(delta * 100)),
      tone: delta == null ? "mute" : delta >= 0 ? "win" : "loss",
    };
  });
  const headlineDelta = stats.moveExp != null ? stats.moveExp - bt.expectancy : null;
  const status = headlineDelta == null ? null : headlineDelta >= 0 ? "over" : "under";
  return {
    scope,
    stats,
    rows,
    headlineDelta,
    status,
    headline: status === "over" ? BACKTEST_HEADLINE_OVER : status === "under" ? BACKTEST_HEADLINE_UNDER : BACKTEST_HEADLINE_NONE,
    sub: stats.moveN
      ? `Erwartung ${signed((headlineDelta ?? 0) * 100, 1)} %-Punkte gegenüber Backtest · ${stats.moveN} Trade${stats.moveN === 1 ? "" : "s"} mit Ein- und Ausstieg`
      : `Sobald du Trades mit Ein- und Ausstieg abschließt, vergleiche ich sie mit dem Backtest (${bt.label}).`,
    warnBadge: stats.moveN > 0 && stats.moveN < 30 ? BACKTEST_WARN_BADGE : null,
    footer: BACKTEST_FOOTER,
  };
}

/** Bundle `h2`: row detail sheet, title "Backtest · {label}". */
export function explainBacktest(key: BacktestRowKey, stats: Agg, s: Pick<Settings, "backtest">): Explanation {
  const bt = s.backtest;
  const you = youOf(key, stats);
  const ref = refOf(key, bt);
  const d = you == null ? null : you - ref;
  const verdict: Verdict =
    d == null
      ? { tone: "mute", text: "Noch keine Trades mit Ein- und Ausstieg." }
      : d >= 0
        ? { tone: "win", text: "Besser als der Backtest." }
        : { tone: "loss", text: "Schlechter als der Backtest." };
  return {
    key: `backtest:${key}`,
    title: ROW_LABELS[key],
    sheetTitle: `Backtest · ${bt.label}`,
    what: WHAT[key],
    formula:
      you == null || d == null
        ? undefined
        : [
            { text: `Du ${pct(you)} − Backtest ${pct(ref)} = ` },
            { text: `${signed(d * 100, 2)} Prozentpunkte`, bold: true, cls: d === 0 ? "text-fg" : d > 0 ? "text-win" : "text-loss" },
          ],
    rows: [
      ["Datenbasis", `${key === "winRate" ? stats.n : stats.moveN} Trades`],
      ["Backtest", bt.label],
    ],
    verdict,
  };
}

export const h2 = explainBacktest;
