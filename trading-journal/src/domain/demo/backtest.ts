/**
 * Der Test der Demo (F58): derselbe Rechenweg wie im Labor – Regelbaum („Eigene Idee“) → `customStrategy` → `runBacktest` →
 * `runStats` – nur auf den künstlichen Beispiel-Kerzen (`candles.ts`) und mit festen, offen genannten Annahmen: Demo-Konto 10 000,
 * 1 % Risiko je Trade, Gebühren wie im Labor (Binance, 2 / 5 Basispunkte), Slippage 2 Basispunkte, kein Funding. Ohne Vorausblick:
 * entschieden am Schluss einer Kerze, gekauft zur Eröffnung der nächsten.
 *
 * `meaningLines` sagt in einfachen Sätzen, was die Zahlen bedeuten und was sie NICHT sagen – mit den Zahlen des Laufs im Text.
 * Nichts davon geht ins Journal, in die Einstellungen oder ins Netz; die Funktionen sind rein.
 */
import { DEFAULT_FEES } from "../backtest/fees";
import { runBacktest } from "../backtest/engine";
import { runStats, type RunStats } from "../backtest/metrics";
import { customStrategy } from "../backtest/strategies/custom";
import type { StrategyFunnel } from "../backtest/strategies/types";
import type { BtTrade, EngineCfg, EquityPoint } from "../backtest/types";
import { warmupMsOf, sanitizeCustom, summarizeCustom, validateCustom } from "../lab/rules/tree";
import { TF_LABEL, TF_SEC, type CustomConfig, type Issue } from "../lab/rules/types";
import { DEFAULT_SIGNAL_CFG } from "../signals/config";
import { demoBars, DEMO_T0, isDemoInterval } from "./candles";
import { pct0, signed } from "@/lib/format";

/** Die festen Annahmen des Demo-Kontos. */
export const DEMO_ENGINE: EngineCfg = {
  capital: 10_000,
  riskPct: 0.01,
  maxLeverage: 5,
  compounding: true,
  costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "none" } },
};

export const DEMO_ASSUMPTIONS: readonly string[] = [
  "Demo-Konto mit 10 000 Einheiten, 1 % Risiko je Trade, höchstens 5-facher Hebel.",
  "Gebühren wie im Labor (Binance: 0,02 % Maker, 0,05 % Taker) und 0,02 % Slippage; kein Funding.",
  "Entschieden wird am Schluss einer Kerze, gekauft zur Eröffnung der nächsten – die Regel sieht nie in die Zukunft.",
  "Berührt eine Kerze Stop und Ziel zugleich, gilt der Stop.",
];

export interface DemoRun {
  status: "ok" | "invalid" | "nodata";
  reason: string | null;
  /** the rules as they ran (the interval may differ from the idea's, see `note`) */
  cfg: CustomConfig;
  note: string | null;
  /** the idea in plain language (`summarizeCustom`) */
  summary: string[];
  issues: Issue[];
  /** execution bars in total / of them warm-up only / of them tradable */
  bars: number;
  warmupBars: number;
  tradableBars: number;
  trades: BtTrade[];
  stats: RunStats | null;
  funnel: StrategyFunnel | null;
  /** marked-to-market equity, at most 120 points */
  curve: number[];
  /** index of the first tradable execution bar */
  start: number;
  /** execution interval in seconds */
  secLen: number;
}

function curveOf(points: readonly EquityPoint[], max = 120): number[] {
  if (points.length <= max) return points.map((p) => p.equity);
  const out: number[] = [];
  for (let k = 0; k < max; k++) out.push(points[Math.round((k * (points.length - 1)) / (max - 1))]!.equity);
  return out;
}

const empty = (cfg: CustomConfig, status: DemoRun["status"], reason: string, extra: Partial<DemoRun> = {}): DemoRun => ({
  status,
  reason,
  cfg,
  note: null,
  summary: summarizeCustom(cfg),
  issues: [],
  bars: 0,
  warmupBars: 0,
  tradableBars: 0,
  trades: [],
  stats: null,
  funnel: null,
  curve: [],
  start: 0,
  secLen: TF_SEC[cfg.interval],
  ...extra,
});

/** Runs a rule set on the example candles. Never throws; a rule set the lab would reject comes back as `invalid` with the reason. */
export function runDemoBacktest(input: CustomConfig): DemoRun {
  let cfg = sanitizeCustom(input);
  let note: string | null = null;
  if (!isDemoInterval(cfg.interval)) {
    note = `Die Idee prüft auf ${TF_LABEL[cfg.interval]}; die Beispiel-Kerzen gibt es in 1h, 2h, 4h und 1D – die Demo rechnet deshalb auf 1h.`;
    cfg = sanitizeCustom({ ...cfg, interval: "1h" });
  }
  const issues = validateCustom(cfg, { funding: false });
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) return empty(cfg, "invalid", errors[0]!.text, { issues, note });
  const data = demoBars();
  const bars = data[cfg.interval] ?? [];
  const warmMs = warmupMsOf(cfg);
  const startMs = DEMO_T0 * 1000 + warmMs;
  let start = 0;
  while (start < bars.length && bars[start]!.t * 1000 < startMs) start++;
  const warmupBars = start;
  const tradable = bars.length - start;
  if (tradable < 60) return empty(cfg, "nodata", `Das Aufwärmen der Regeln braucht ${Math.ceil(warmMs / 86_400_000)} Tage der Beispiel-Kerzen – es blieben nur ${Math.max(0, tradable)} Kerzen zum Handeln. Wähle kürzere Zeitfenster.`, { issues, note, bars: bars.length, warmupBars });
  try {
    const cfgIn = { config: cfg, signal: DEFAULT_SIGNAL_CFG };
    const prep = customStrategy.prepare(data, cfgIn, startMs).result();
    const strat = customStrategy.build(prep, {});
    const secLen = TF_SEC[cfg.interval];
    const run = runBacktest(prep.bars, strat, DEMO_ENGINE, { from: prep.start, to: prep.bars.length - 1, atr: prep.atr, secLen });
    const funnel = customStrategy.funnel ? customStrategy.funnel(prep, {}, { from: prep.start, to: prep.bars.length - 1 }) : null;
    return {
      status: "ok",
      reason: null,
      cfg,
      note,
      summary: summarizeCustom(cfg),
      issues,
      bars: bars.length,
      warmupBars,
      tradableBars: tradable,
      trades: run.trades,
      stats: runStats(run),
      funnel,
      curve: curveOf(run.equity),
      start: prep.start,
      secLen,
    };
  } catch (e) {
    return empty(cfg, "invalid", e instanceof Error ? e.message : "Der Lauf ist fehlgeschlagen.", { issues, note });
  }
}

/** Sample word for `n` trades (the demo's own, plain). */
export function sampleWord(n: number): string {
  return n === 0 ? "keine Trades" : n < 10 ? "viel zu wenig" : n < 30 ? "wenig" : n < 100 ? "mäßig" : "solide";
}

const de2 = (v: number): string => signed(v, 2).replace("+", "");

/** What the figures mean – in numbers of THIS run, plain German, no promise. */
export function meaningLines(run: DemoRun): string[] {
  const s = run.stats;
  if (!s) return [];
  const lines: string[] = [];
  if (s.n === 0) {
    lines.push("Die Regeln haben auf diesen Beispiel-Kerzen keinen einzigen Trade ausgelöst. Das ist ein Ergebnis, kein Fehler: Die Bedingungen waren nie gleichzeitig neu erfüllt (der Trichter oben zeigt, wo es hakt).");
    return lines;
  }
  lines.push(`${s.n} Trades: Stichprobe ${sampleWord(s.n)}. ${s.n < 30 ? "Unter 30 Trades sagt eine Quote kaum etwas – ein paar Zufallstreffer reichen für jedes Bild." : s.n < 100 ? "Ab etwa 30 Trades sagt eine Quote etwas, die Spanne bleibt aber breit; für ein Urteil über eine Regel braucht es meist hunderte Trades." : "Genug, um die Spannen enger zu sehen – für eine Regel zählt trotzdem nur, was auf neuen Daten hält."}`);
  if (s.winRate != null && s.winRateCI) lines.push(`Trefferquote ${pct0(s.winRate)}, 80 %-Spanne ${pct0(s.winRateCI.lo).replace(" %", "")}–${pct0(s.winRateCI.hi)}. Die Spanne zeigt, wie unsicher die Quote bei dieser Stichprobe ist; sie ist die ehrliche Zahl, nicht der Punkt in der Mitte.`);
  if (s.avgR != null) lines.push(`Ø ${signed(s.avgR, 2)} R pro Trade${s.rCI ? ` (80 %-Spanne ${signed(s.rCI.lo, 2)} bis ${signed(s.rCI.hi, 2)})` : ""}. R ist das Ergebnis in Vielfachen des Risikos: +1 R heißt, du hast so viel gewonnen, wie du riskiert hast. Eine Spanne, die die 0 einschließt, belegt keinen Vorteil.`);
  lines.push(`Netto ${signed(s.netPct * 100, 1)} % des Demo-Kontos, nach ${de2(s.fees)} Gebühren und ${de2(s.slippage)} Slippage. Größter Rückgang zwischendurch: ${pct0(s.maxDD)}.`);
  if (s.pEdge != null) lines.push(`Test auf einen Vorteil (Ø R > 0): p = ${s.pEdge.toFixed(2).replace(".", ",")}. ${s.pEdge <= 0.1 && s.n >= 30 ? "Das spricht auf diesen Kerzen für einen Vorteil – auf künstlichen Kerzen heißt das nichts für einen Markt." : "Das ist kein Beleg für einen Vorteil."}`);
  lines.push("Ein Test beweist keinen Gewinn. Jede weitere Variante, die du ausprobierst, erhöht die Chance auf einen Zufallstreffer – im Labor rechnet die App das mit (Mehrfachtest-Korrektur, Walk-forward).");
  return lines;
}
