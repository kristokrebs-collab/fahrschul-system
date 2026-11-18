/**
 * `auditRun(result, bars)` – the Strategie-Prüfbericht (F18). Deterministic, no LLM, no I/O: it reads a finished lab run
 * and, when at hand, the execution bars of the run, and returns what the other robustness cards do not say:
 *   Ausreißerabhängigkeit   the result without the best 1 / 3 / 5 trades (and, for contrast, without the worst ones)
 *   Datenlücken             holes per interval, the biggest ones with dates, trades that were open across a hole
 *   Signale                 handed over / skipped / blocked, and what "nachträglich" can and cannot mean here
 *   Prüfzeiträume           the out-of-sample cut, the walk-forward windows, what was only ever training, quiet stretches
 * Every sentence names the number of trades it rests on; below `AUDIT.minTrades` it says so instead of judging.
 */
import { gapSpans } from "../../backtest/bars";
import type { LabResult } from "../../backtest/job";
import type { Bar, BtTrade } from "../../backtest/types";
import { HIST_MS } from "../../backtest/types";
import {
  AUDIT_VERSION,
  type Audit,
  type DataView,
  type GapSpanView,
  type OutlierRow,
  type OutlierVerdict,
  type OutlierView,
  type PeriodsView,
  type QuietStretch,
  type SignalsView,
  type ThirdView,
} from "./types";

/** Thresholds of the report (named so a test and a reader can see what "few" means). */
export const AUDIT = {
  /** fewest trades for a statement about outliers */
  minTrades: 10,
  /** outlier counts */
  ks: [1, 3, 5] as readonly number[],
  /** a row is "thin" when the removed trades are at least this share of all trades */
  thinShare: 0.2,
  /** holes above this share of the series are flagged */
  missingShare: 0.02,
  /** longest quiet stretches shown, and the least length of one (days) */
  quietShown: 3,
  quietMinDays: 1,
} as const;

const DAY = 86_400_000;

const dec = (v: number, d = 2): string => v.toFixed(d).replace(".", ",").replace("-", "−");
const rr = (v: number | null): string => (v == null ? "–" : `${v > 0 ? "+" : ""}${dec(v)} R`);
const cnt = (v: number): string => v.toLocaleString("de-DE");
const pct = (v: number, d = 0): string => `${dec(v * 100, d)} %`;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

function pfOf(trades: readonly BtTrade[]): number | null {
  let gw = 0;
  let gl = 0;
  for (const t of trades) {
    if (t.pnl > 0) gw += t.pnl;
    else gl += t.pnl;
  }
  return gl < 0 ? gw / -gl : null;
}

// ── Ausreißerabhängigkeit ─────────────────────────────────────────────────────────────────────────────────────────

function outliersOf(trades: readonly BtTrade[]): OutlierView {
  const n = trades.length;
  const sumR = sum(trades.map((t) => t.r));
  const base = { n, sumR, avgR: n ? sumR / n : null, pf: pfOf(trades), net: sum(trades.map((t) => t.pnl)) };
  // by R, best first (a stable order for ties: the earlier trade first)
  const order = trades.map((t, i) => ({ t, i })).sort((a, b) => b.t.r - a.t.r || a.i - b.i);
  const rows: OutlierRow[] = [];
  const row = (k: number, kind: "best" | "worst"): OutlierRow => {
    const out = new Set((kind === "best" ? order.slice(0, k) : order.slice(n - k)).map((o) => o.i));
    const rest = trades.filter((_, i) => !out.has(i));
    const restR = sum(rest.map((t) => t.r));
    return {
      k,
      kind,
      removedSumR: sumR - restR,
      remainN: rest.length,
      remainSumR: restR,
      remainAvgR: rest.length ? restR / rest.length : null,
      remainPf: pfOf(rest),
      remainNet: sum(rest.map((t) => t.pnl)),
      flipsSign: Math.sign(restR) !== Math.sign(sumR) && sumR !== 0,
      thin: k / n >= AUDIT.thinShare,
    };
  };
  if (n >= AUDIT.minTrades) {
    for (const k of AUDIT.ks) if (k < n) rows.push(row(k, "best"));
    for (const k of AUDIT.ks) if (k < n) rows.push(row(k, "worst"));
  }
  let verdict: OutlierVerdict;
  let text: string;
  const best = (k: number) => rows.find((r) => r.kind === "best" && r.k === k);
  if (n < AUDIT.minTrades) {
    verdict = "zuwenig";
    text = n ? `Mit ${n} Trades lässt sich die Abhängigkeit von einzelnen Trades nicht beurteilen (ab ${AUDIT.minTrades} Trades wird sie gerechnet).` : "Ohne Trades gibt es nichts zu prüfen.";
  } else if (!(sumR > 0)) {
    verdict = "verlust";
    text = `Schon mit allen ${n} Trades ist das Ergebnis nicht positiv (${rr(sumR)}). Die Frage nach Ausreißern stellt sich hier nicht – der Blick auf die schlechtesten Trades zeigt, was fehlt.`;
  } else {
    const b1 = best(1);
    const b3 = best(3);
    const b5 = best(5);
    const first = [b1, b3, b5].find((r) => r && r.remainSumR <= 0);
    if (first) {
      verdict = "abhaengig";
      text = `Ohne die besten ${first.k} von ${n} Trades bleibt ${rr(first.remainSumR)} übrig (mit allen: ${rr(sumR)}). Das Ergebnis hängt an wenigen Trades – ein Hinweis, kein Beweis.`;
    } else {
      verdict = "tragfaehig";
      const last = b5 ?? b3 ?? b1;
      text = `Auch ohne die besten ${last?.k ?? 0} von ${n} Trades bleibt ${rr(last?.remainSumR ?? null)} übrig. Bei ${n} Trades sagt das nichts über Trades, die noch kommen.`;
    }
  }
  return { ...base, rows, verdict, text };
}

// ── Datenlücken ───────────────────────────────────────────────────────────────────────────────────────────────────

function dataOf(r: LabResult, bars: readonly Bar[] | null): DataView {
  const exec = r.coverage.find((c) => c.role === "exec");
  const gaps = exec?.gaps ?? r.gaps.gaps;
  const missing = exec?.missing ?? r.gaps.missing;
  const secLen = (HIST_MS[r.interval as keyof typeof HIST_MS] ?? 0) / 1000;
  let spans: GapSpanView[] = [];
  let spanCount = 0;
  let tradesOverGap: number | null = null;
  if (bars && bars.length && secLen > 0) {
    const all = gapSpans(bars, secLen);
    const inPeriod = all.filter((g) => g.toS * 1000 > r.from && g.fromS * 1000 < r.to);
    spanCount = inPeriod.length;
    spans = [...inPeriod]
      .sort((a, b) => b.missing - a.missing || a.index - b.index)
      .slice(0, 5)
      .map((g) => ({ fromMs: (g.fromS + secLen) * 1000, toMs: g.toS * 1000, missing: g.missing }));
    tradesOverGap = r.trades.filter((t) => inPeriod.some((g) => g.index > t.entryIndex && g.index <= t.exitIndex)).length;
  }
  const missingShare = r.bars + missing > 0 ? missing / (r.bars + missing) : null;
  const notes: string[] = [];
  if (!gaps) notes.push(`Keine Lücken in den ${cnt(r.bars)} Kerzen der Ausführungsebene.`);
  else {
    notes.push(`${cnt(gaps)} Lücke${gaps === 1 ? "" : "n"} in der Ausführungsebene, zusammen ${cnt(missing)} fehlende Kerzen${missingShare != null ? ` (${pct(missingShare, 1)})` : ""}.`);
    if (missingShare != null && missingShare > AUDIT.missingShare) notes.push("Das ist mehr als 2 % der Kerzen: Stops und Ziele wurden über diese Zeiten nicht geprüft.");
  }
  if (tradesOverGap != null && tradesOverGap > 0) notes.push(`${tradesOverGap} von ${r.trades.length} Trades waren über eine Lücke hinweg offen; ob Stop oder Ziel dort schon berührt wurden, weiß das Labor nicht.`);
  if (r.warmup.got < r.warmup.wanted) notes.push(`Vorlauf für die Indikatoren zu kurz (${cnt(r.warmup.got)} von ${cnt(r.warmup.wanted)} Kerzen): die ersten Signale rechnen mit weniger Verlauf, als die Strategie vorsieht.`);
  if (!bars || !bars.length) notes.push("Die Kerzen des Laufs liegen nicht mehr vor – die einzelnen Lücken und die betroffenen Trades lassen sich nicht aufzählen.");
  return {
    rows: r.coverage,
    interval: r.interval,
    expected: r.expectedBars,
    received: r.bars,
    receivedShare: r.expectedBars > 0 ? Math.min(1, r.bars / r.expectedBars) : null,
    gaps,
    missing,
    missingShare,
    warmupWanted: r.warmup.wanted,
    warmupGot: r.warmup.got,
    spans,
    spanCount,
    tradesOverGap,
    notes,
  };
}

// ── Signale ───────────────────────────────────────────────────────────────────────────────────────────────────────

function signalsOf(r: LabResult): SignalsView {
  const f = r.funnel;
  const skipped = f.skippedGap + f.skippedRisk;
  return {
    examined: f.examined,
    edges: f.edges,
    conflicts: f.conflicts,
    candidates: f.candidates,
    blockedByPosition: f.blockedByPosition,
    handed: f.signals,
    skippedGap: f.skippedGap,
    skippedRisk: f.skippedRisk,
    executed: f.executed,
    skippedShare: f.signals > 0 ? skipped / f.signals : null,
    late: {
      n: null,
      text: "Nachträglich sichtbare Signale schließt das Labor durch seinen Aufbau aus: Jede Kerze wird nur mit Daten bis zu ihrem Schluss bewertet, gehandelt wird zum Open der nächsten. In diesem Lauf wurde das nicht einzeln nachgemessen; die Unit-Tests prüfen es an echten Kerzen (Verlauf nach der Kerze abgeschnitten, gleiches Signal).",
    },
  };
}

// ── Prüfzeiträume ─────────────────────────────────────────────────────────────────────────────────────────────────

function periodsOf(r: LabResult): PeriodsView {
  const span = Math.max(1, r.to - r.from);
  const days = (r.to - r.from) / DAY;
  const oosUsed = r.split.params != null;
  const oos = {
    cutTime: r.split.cutTime,
    share: r.split.cutTime != null ? Math.max(0, Math.min(1, (r.to - r.split.cutTime) / span)) : null,
    n: oosUsed ? (r.split.oos?.n ?? 0) : null,
    used: oosUsed,
  };
  let walkForward: PeriodsView["walkForward"] = null;
  if (r.wf && r.wf.windows.length) {
    const w = r.wf.windows;
    walkForward = {
      windows: w.length,
      testShare: Math.min(1, w.reduce((s, x) => s + Math.max(0, x.testTo - x.testFrom), 0) / span),
      trainOnlyShare: Math.max(0, Math.min(1, (w[0]!.testFrom - r.from) / span)),
      emptyWindows: w.filter((x) => x.testN === 0).length,
      testTrades: r.wf.oosN,
    };
  }
  // stretches without an open trade
  const quiet: QuietStretch[] = [];
  const byEntry = [...r.trades].sort((a, b) => a.entryTime - b.entryTime);
  let cursor = r.from;
  const push = (from: number, to: number): void => {
    if ((to - from) / DAY >= AUDIT.quietMinDays) quiet.push({ fromMs: from, toMs: to, days: (to - from) / DAY, share: (to - from) / span });
  };
  for (const t of byEntry) {
    if (t.entryTime > cursor) push(cursor, t.entryTime);
    cursor = Math.max(cursor, t.exitTime);
  }
  if (r.to > cursor) push(cursor, r.to);
  quiet.sort((a, b) => b.days - a.days || a.fromMs - b.fromMs);
  const thirds: ThirdView[] = [0, 1, 2].map((k) => {
    const from = r.from + (span * k) / 3;
    const to = r.from + (span * (k + 1)) / 3;
    const inside = r.trades.filter((t) => t.entryTime >= from && (k === 2 ? t.entryTime <= to : t.entryTime < to));
    return { from, to, n: inside.length, sumR: sum(inside.map((t) => t.r)) };
  });
  const notes: string[] = [];
  if (!oosUsed) notes.push("Für den Out-of-Sample-Teil gab es keinen Parametersatz mit genug Trades im Training: der letzte Abschnitt blieb ungenutzt.");
  else if ((oos.n ?? 0) < AUDIT.minTrades) notes.push(`Im ungesehenen Abschnitt liegen nur ${oos.n ?? 0} Trades – zu wenig, um daraus etwas abzuleiten.`);
  if (!walkForward) notes.push("Für Walk-forward war der Zeitraum zu kurz.");
  else if (walkForward.trainOnlyShare != null && walkForward.trainOnlyShare > 0) notes.push(`Die ersten ${pct(walkForward.trainOnlyShare)} des Zeitraums dienten im Walk-forward nur dem Training und wurden nie ungesehen gehandelt.`);
  notes.push("Einen eigenen, zurückgehaltenen Prüfzeitraum jenseits davon gibt es nicht: Der Hauptlauf oben rechnet über den ganzen Zeitraum. Wer Parameter nach diesem Bericht ändert, prüft sie am besten auf Kerzen, die noch nie zu sehen waren.");
  return { from: r.from, to: r.to, days, oos, walkForward, quiet: quiet.slice(0, AUDIT.quietShown), thirds, notes };
}

/** The audit of a finished run; `bars` = the execution bars of the run (index space of its trades), if still at hand. */
export function auditRun(result: LabResult, bars: readonly Bar[] | null = null): Audit {
  return {
    v: AUDIT_VERSION,
    n: result.trades.length,
    outliers: outliersOf(result.trades),
    data: dataOf(result, bars),
    signals: signalsOf(result),
    periods: periodsOf(result),
    robust: { verdict: result.robust.verdict, text: result.robust.text, reasons: result.robust.reasons },
  };
}
