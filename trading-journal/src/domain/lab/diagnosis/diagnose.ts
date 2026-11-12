/**
 * `diagnoseRun(result, cfg, data)` – "Warum so schwach?" (F73). Deterministic, no LLM, no I/O: it reads a finished lab
 * run (`LabResult`: trades, stats, funnel, coverage, comparison variants), the set-up it ran with and the execution bars,
 * and returns a serialisable `Diagnosis` – data coverage, the rule funnel from the examined candles to the closed trades,
 * gross vs net, exits by reason, long vs short, hour / weekday, average vs median, MAE / MFE, how often a stop and a
 * take-profit shared one candle, sample-size warnings and a ranked list of findings.
 *
 * Every finding is an OBSERVATION written as a fact with the numbers it rests on; where it points to a possible lever it
 * says "evtl." / "deutet darauf hin" and never claims a cause.
 */
import { atrSeries } from "../../backtest/bars";
import { EXIT_LABEL, type BtTrade } from "../../backtest/types";
import type { LabResult } from "../../backtest/job";
import {
  DIAGNOSIS_VERSION,
  type BucketRow,
  type CompareRow,
  type CostView,
  type CoverageView,
  type Diagnosis,
  type DiagnoseCfg,
  type DiagnoseData,
  type ExcursionView,
  type ExitRow,
  type Finding,
  type FunnelStageView,
  type PayoffView,
  type SampleLevel,
  type SampleView,
  type Severity,
  type SideRow,
} from "./types";

// ── small numbers helpers ─────────────────────────────────────────────────────────────────────────────────────

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]): number | null => (xs.length ? sum(xs) / xs.length : null);
function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const fin = (v: number | null | undefined): number | null => (v != null && Number.isFinite(v) ? v : null);

const dec = (v: number, d: number): string => v.toFixed(d).replace(".", ",").replace("-", "−");
const pct = (v: number, d = 0): string => `${dec(v * 100, d)} %`;
const rr = (v: number | null, d = 2): string => (v == null ? "–" : `${v > 0 ? "+" : ""}${dec(v, d)} R`);
const money = (v: number): string => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v)).toLocaleString("de-DE")} USDT`;
const cnt = (v: number): string => v.toLocaleString("de-DE");
/** A cost in money: paid ("12 USDT") or, for funding that was received, "12 USDT erhalten". */
const amount = (v: number): string => (v >= 0 ? `${cnt(Math.round(v))} USDT` : `${cnt(Math.round(-v))} USDT erhalten`);

/** Thresholds of the findings (named so a test and a reader can see what "many" means). */
export const DIAG = {
  /** fewest trades for a statement about an average */
  minForAverages: 10,
  /** … for splits by side / hour / weekday */
  minForSplits: 60,
  quickStopBars: 3,
  quickStopShare: 0.5,
  loserReached1R: 0.3,
  costShare: 0.4,
  skippedShare: 0.2,
  ambiguousShare: 0.1,
  missingShare: 0.02,
  blockedShare: 0.5,
} as const;

// ── per-trade facts ───────────────────────────────────────────────────────────────────────────────────────────

interface TradeFacts {
  t: BtTrade;
  risk: number;
  cost: number;
  gross: number;
  /** excursions in R (null without bars) */
  mfe: number | null;
  mae: number | null;
  /** stop distance in ATR(14) of the signal bar / percent of the entry */
  stopAtr: number | null;
  stopPct: number;
}

function factsOf(trades: readonly BtTrade[], data: DiagnoseData): TradeFacts[] {
  const bars = data.bars;
  const atr = bars.length ? atrSeries(bars as never) : [];
  return trades.map((t) => {
    const dist = Math.abs(t.entry - t.stop);
    const risk = dist * t.qty;
    const cost = t.fees + t.slippage + t.funding;
    let mfe: number | null = null;
    let mae: number | null = null;
    if (dist > 0 && t.exitIndex < bars.length && t.entryIndex >= 0 && t.exitIndex >= t.entryIndex) {
      let hi = -Infinity;
      let lo = Infinity;
      for (let k = t.entryIndex; k <= t.exitIndex; k++) {
        hi = Math.max(hi, bars[k]!.h);
        lo = Math.min(lo, bars[k]!.l);
      }
      mfe = (t.side === "long" ? hi - t.entry : t.entry - lo) / dist;
      mae = (t.side === "long" ? t.entry - lo : hi - t.entry) / dist;
    }
    const a = atr[t.entryIndex - 1];
    return { t, risk, cost, gross: t.pnl + cost, mfe: fin(mfe), mae: fin(mae), stopAtr: a != null && a > 0 && dist > 0 ? dist / a : null, stopPct: t.entry > 0 ? dist / t.entry : 0 };
  });
}

// ── sections ──────────────────────────────────────────────────────────────────────────────────────────────────

function coverageOf(r: LabResult): CoverageView {
  const exec = r.coverage.find((c) => c.role === "exec");
  const gaps = exec?.gaps ?? r.gaps.gaps;
  const missing = exec?.missing ?? r.gaps.missing;
  return {
    rows: r.coverage,
    expected: r.expectedBars,
    received: r.bars,
    receivedShare: r.expectedBars > 0 ? Math.min(1, r.bars / r.expectedBars) : null,
    gaps,
    missing,
    warmupWanted: r.warmup.wanted,
    warmupGot: r.warmup.got,
    warmupOk: r.warmup.got >= r.warmup.wanted,
  };
}

function funnelOf(r: LabResult): FunnelStageView[] {
  const f = r.funnel;
  const out: FunnelStageView[] = [{ id: "examined", label: "Kerzen im Zeitraum geprüft", count: f.examined, kind: "stage" }];
  for (const n of f.nodes) out.push({ id: n.id, label: `${n.side === "long" ? "Long" : "Short"} · ${n.label}`, count: n.t, unknown: n.u, depth: n.depth, kind: n.kind });
  if (f.edges != null) out.push({ id: "edges", label: "Neue Signale (Regel erfüllt, an der Kerze davor nicht)", count: f.edges, kind: "stage" });
  if (f.conflicts) out.push({ id: "conflicts", label: "davon Long und Short gleichzeitig (nicht gehandelt)", count: f.conflicts, kind: "loss" });
  if (f.candidates != null) out.push({ id: "candidates", label: "Neue Signale mit gültigem Stop", count: f.candidates, kind: "stage" });
  if (f.blockedByPosition) out.push({ id: "blocked", label: "davon bei offener Position (kein neuer Einstieg)", count: f.blockedByPosition, kind: "loss" });
  out.push({ id: "signals", label: "An die Engine übergeben (Position frei)", count: f.signals, kind: "stage" });
  if (f.skippedGap) out.push({ id: "skipGap", label: "davon übersprungen: Eröffnung schon hinter Stop oder Ziel", count: f.skippedGap, kind: "loss" });
  if (f.skippedRisk) out.push({ id: "skipRisk", label: "davon übersprungen: Stop zu eng oder keine Größe", count: f.skippedRisk, kind: "loss" });
  out.push({ id: "executed", label: "Ausgeführt und geschlossen", count: f.executed, kind: "stage" });
  return out;
}

function costsOf(fs: readonly TradeFacts[]): CostView {
  const fees = sum(fs.map((x) => x.t.fees));
  const slippage = sum(fs.map((x) => x.t.slippage));
  const funding = sum(fs.map((x) => x.t.funding));
  const net = sum(fs.map((x) => x.t.pnl));
  const gross = net + fees + slippage + funding;
  const costR = fs.filter((x) => x.risk > 0).map((x) => x.cost / x.risk);
  return {
    gross,
    fees,
    slippage,
    funding,
    net,
    costShare: Math.abs(gross) > 1e-9 ? (fees + slippage + funding) / Math.abs(gross) : null,
    avgCostR: mean(costR),
    medCostR: median(costR),
    grossR: sum(fs.filter((x) => x.risk > 0).map((x) => x.gross / x.risk)),
    netR: sum(fs.map((x) => x.t.r)),
  };
}

function exitsOf(fs: readonly TradeFacts[]): ExitRow[] {
  const by = new Map<string, TradeFacts[]>();
  for (const x of fs) by.set(x.t.reason, [...(by.get(x.t.reason) ?? []), x]);
  return [...by.entries()]
    .map(([reason, xs]) => ({
      reason,
      label: EXIT_LABEL[reason as keyof typeof EXIT_LABEL] ?? reason,
      n: xs.length,
      share: xs.length / Math.max(1, fs.length),
      avgR: mean(xs.map((x) => x.t.r)),
      sumR: sum(xs.map((x) => x.t.r)),
      winShare: xs.length ? xs.filter((x) => x.t.pnl > 0).length / xs.length : null,
    }))
    .sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason));
}

function sidesOf(fs: readonly TradeFacts[]): SideRow[] {
  return (["long", "short"] as const)
    .map((side) => {
      const xs = fs.filter((x) => x.t.side === side);
      return { side, n: xs.length, winRate: xs.length ? xs.filter((x) => x.t.pnl > 0).length / xs.length : null, avgR: mean(xs.map((x) => x.t.r)), net: sum(xs.map((x) => x.t.pnl)) };
    })
    .filter((s) => s.n > 0);
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

function bucketsOf(fs: readonly TradeFacts[], key: (t: BtTrade) => number, count: number, label: (k: number) => string): BucketRow[] {
  const rows: BucketRow[] = [];
  for (let k = 0; k < count; k++) {
    const xs = fs.filter((x) => key(x.t) === k);
    rows.push({ key: k, label: label(k), n: xs.length, avgR: mean(xs.map((x) => x.t.r)), winRate: xs.length ? xs.filter((x) => x.t.pnl > 0).length / xs.length : null });
  }
  return rows;
}

function payoffOf(fs: readonly TradeFacts[], winRate: number | null): PayoffView {
  const wins = fs.filter((x) => x.t.pnl > 0).map((x) => x.t.r);
  const losses = fs.filter((x) => x.t.pnl < 0).map((x) => x.t.r);
  const avgWin = mean(wins);
  const avgLoss = mean(losses);
  const total = sum(fs.map((x) => x.t.r));
  const top3 = [...fs.map((x) => x.t.r)].sort((a, b) => b - a).slice(0, 3);
  return {
    winRate,
    avgWinR: avgWin,
    avgLossR: avgLoss,
    medWinR: median(wins),
    medLossR: median(losses),
    avgR: mean(fs.map((x) => x.t.r)),
    medR: median(fs.map((x) => x.t.r)),
    breakEvenWinRate: avgWin != null && avgLoss != null && avgWin > 0 && avgLoss < 0 ? -avgLoss / (avgWin - avgLoss) : null,
    top3Share: total > 0 ? sum(top3) / total : null,
  };
}

function excursionOf(fs: readonly TradeFacts[]): ExcursionView {
  const losers = fs.filter((x) => x.t.pnl < 0);
  const withMfe = (xs: readonly TradeFacts[]) => xs.filter((x) => x.mfe != null);
  const lm = withMfe(losers);
  const stopLosers = losers.filter((x) => x.t.reason === "stop");
  const quick = stopLosers.filter((x) => x.t.bars <= DIAG.quickStopBars);
  return {
    stopAtrMed: median(fs.flatMap((x) => (x.stopAtr != null ? [x.stopAtr] : []))),
    stopPctMed: median(fs.map((x) => x.stopPct)),
    mfeMed: median(withMfe(fs).map((x) => x.mfe!)),
    maeMed: median(fs.flatMap((x) => (x.mae != null ? [x.mae] : []))),
    loserMfeMed: median(lm.map((x) => x.mfe!)),
    losersReached1R: lm.length ? lm.filter((x) => x.mfe! >= 1).length / lm.length : null,
    losersReachedHalfR: lm.length ? lm.filter((x) => x.mfe! >= 0.5).length / lm.length : null,
    quickStopShare: stopLosers.length ? quick.length / stopLosers.length : null,
    quickStopN: quick.length,
    stopLosses: stopLosers.length,
  };
}

function sampleOf(n: number, r: LabResult): SampleView {
  const level: SampleLevel = n === 0 ? "none" : n < 10 ? "tiny" : n < 30 ? "small" : n < 100 ? "ok" : "good";
  const warnings: string[] = [];
  if (n === 0) warnings.push("Ohne Trades gibt es keine Kennzahl.");
  else if (n < 10) warnings.push(`Nur ${n} Trade${n === 1 ? "" : "s"}: Ø R, Win-Rate und alle Vergleiche sind in diesem Bereich Zufall.`);
  else if (n < 30) warnings.push(`Mit ${n} Trades sind die Kennzahlen noch unsicher.`);
  const ci = r.stats.rCI;
  if (n >= 2 && n < 100 && ci) warnings.push(`Ø R liegt bei ${n} Trades mit 80 % Sicherheit zwischen ${rr(ci.lo)} und ${rr(ci.hi)}.`);
  if (n > 0 && n < DIAG.minForSplits) warnings.push(`Aufteilungen nach Richtung, Uhrzeit und Wochentag sind erst ab ${DIAG.minForSplits} Trades aussagekräftig.`);
  return { n, level, warnings };
}

function compareOf(r: LabResult): CompareRow[] {
  const s = r.stats;
  const base: CompareRow = { id: "base", label: "Dein Lauf", kind: "base", n: s.n, avgR: s.avgR, sumR: s.sumR, net: s.net, winRate: s.winRate, deltaAvgR: null };
  const rows = r.variants.map((v): CompareRow => ({ id: v.id, label: v.label, kind: v.kind, n: v.n, avgR: v.avgR, sumR: v.sumR, net: v.net, winRate: v.winRate, deltaAvgR: v.avgR != null && s.avgR != null ? v.avgR - s.avgR : null }));
  return [base, ...rows];
}

// ── findings ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Ranked extends Finding {
  weight: number;
}
const SEV: Record<Severity, number> = { high: 3, medium: 2, info: 1 };

function findingsOf(r: LabResult, cfg: DiagnoseCfg, fs: readonly TradeFacts[], d: Omit<Diagnosis, "findings">): Finding[] {
  const out: Ranked[] = [];
  const add = (f: Omit<Ranked, "weight">, weight = 0) => out.push({ ...f, weight });
  const n = fs.length;
  const s = r.stats;

  // — nothing traded: which stage ate the signals
  if (n === 0) {
    const fun = r.funnel;
    const total = Math.max(1, fun.examined);
    const leaves = fun.nodes.filter((x) => x.kind === "leaf");
    const never = leaves.filter((x) => x.t === 0 && x.u < total);
    const unknown = leaves.filter((x) => x.u / total >= 0.5);
    const ev: { label: string; value: string }[] = [{ label: "Kerzen geprüft", value: cnt(fun.examined) }];
    let text = "Im Zeitraum hat die Strategie kein Signal erzeugt.";
    if (d.coverage.received < 120) text = `Es gibt nur ${cnt(d.coverage.received)} Kerzen im Zeitraum – zu wenig für eine Auswertung.`;
    else if (unknown.length) {
      const u = unknown[0]!;
      text = `„${u.label}“ hatte in ${pct(u.u / total)} der Kerzen nicht genug Daten (unbekannt) und kann deshalb nie erfüllt werden.`;
      ev.push({ label: "unbekannt", value: `${cnt(u.u)} von ${cnt(total)}` });
    } else if (never.length) {
      const names = never.slice(0, 3).map((x) => `„${x.label}“`);
      text = `${names.join(", ")} ${never.length === 1 ? "war" : "waren"} in keiner einzigen der ${cnt(total)} Kerzen erfüllt.`;
      ev.push({ label: "nie erfüllt", value: String(never.length) });
    } else if (fun.nodes.length && fun.nodes.filter((x) => x.kind === "side").every((x) => x.t === 0)) {
      const best = leaves.reduce((m, x) => (x.t > m.t ? x : m), leaves[0]!);
      text = `Jede Bedingung gilt zeitweise, aber nie alle zugleich${best ? ` (am häufigsten „${best.label}“ in ${pct(best.t / total)} der Kerzen)` : ""}.`;
    } else if (fun.edges === 0) text = "Die Regeln galten, aber nie als NEUES Signal – sie waren schon vor dem Zeitraum erfüllt und blieben es.";
    else if (fun.signals > 0 && fun.executed === 0) {
      text = `${fun.signals} Signal${fun.signals === 1 ? "" : "e"} kamen bei der Engine an, aber keins wurde eröffnet (${fun.skippedGap} hinter Stop oder Ziel, ${fun.skippedRisk} Stop zu eng).`;
    } else if (fun.candidates === 0 && (fun.edges ?? 0) > 0) text = `${fun.edges} neue Signale hatten keinen gültigen Stop oder trafen Long und Short zugleich.`;
    add({ id: "no-trades", severity: "high", title: "Keine Trades", text, evidence: ev }, 1000);
  } else {
    // — sample size
    if (n < 10) add({ id: "sample", severity: "high", title: "Zu wenige Trades", text: `Nur ${n} Trade${n === 1 ? "" : "s"}: jede Kennzahl hier kann Zufall sein.`, evidence: [{ label: "Trades", value: String(n) }] }, 500);
    else if (n < 30) add({ id: "sample", severity: "medium", title: "Kleine Stichprobe", text: `Mit ${n} Trades ist das Bild noch unsicher; unter 30 Trades schwanken Ø R und Win-Rate stark.`, evidence: [{ label: "Trades", value: String(n) }] }, 200);
  }

  const c = d.costs;
  if (n >= 1) {
    // — costs vs the idea itself
    const cost = c.fees + c.slippage + c.funding;
    if (c.gross > 0 && c.net <= 0) {
      add(
        {
          id: "costs-flip",
          severity: "high",
          title: "Die Kosten kippen das Ergebnis",
          text: `Vor Kosten ${money(c.gross)} (${rr(c.grossR)}), danach ${money(c.net)}: Gebühren ${amount(c.fees)}, Slippage ${amount(c.slippage)}, Funding ${amount(c.funding)}.`,
          evidence: [
            { label: "Brutto", value: money(c.gross) },
            { label: "Netto", value: money(c.net) },
            { label: "Kosten gesamt", value: `${cnt(Math.round(cost))} USDT` },
            { label: "Ø Kosten pro Trade", value: rr(c.avgCostR) },
          ],
        },
        900 + Math.min(99, (c.costShare ?? 0) * 10),
      );
    } else if (c.gross > 0 && c.costShare != null && c.costShare >= DIAG.costShare) {
      add({ id: "costs-heavy", severity: "medium", title: "Kosten fressen einen großen Teil", text: `Gebühren, Slippage und Funding nehmen ${pct(c.costShare)} des Bruttoergebnisses (${money(c.gross)}); netto bleiben ${money(c.net)}.`, evidence: [{ label: "Kostenanteil", value: pct(c.costShare) }, { label: "Ø Kosten pro Trade", value: rr(c.avgCostR) }] }, 400 + c.costShare * 10);
    } else if (c.gross <= 0 && n >= DIAG.minForAverages) {
      add(
        {
          id: "no-edge-gross",
          severity: "high",
          title: "Schon vor Kosten im Minus",
          text: `Auch ohne Gebühren, Slippage und Funding steht der Lauf bei ${money(c.gross)} (${rr(c.grossR)} insgesamt). In diesem Zeitraum liefern die Einstiege selbst keinen Vorsprung – an den Kosten allein liegt es nicht.`,
          evidence: [{ label: "Brutto", value: money(c.gross) }, { label: "Netto", value: money(c.net) }, { label: "Trades", value: String(n) }],
        },
        800,
      );
    }
    if (c.avgCostR != null && c.avgCostR >= 0.15 && n >= DIAG.minForAverages) {
      add({ id: "cost-per-trade", severity: c.avgCostR >= 0.3 ? "medium" : "info", title: "Kosten pro Trade im Verhältnis zum Risiko", text: `Jeder Trade kostet im Schnitt ${dec(c.avgCostR, 2)} R an Gebühren, Slippage und Funding. Bei einem Stop von median ${d.excursion.stopPctMed != null ? pct(d.excursion.stopPctMed, 2) : "–"} vom Kurs fällt das stärker ins Gewicht als bei weiten Stops.`, evidence: [{ label: "Ø Kosten", value: rr(c.avgCostR) }, { label: "Median Kosten", value: rr(c.medCostR) }, { label: "Stop (Median)", value: d.excursion.stopPctMed != null ? pct(d.excursion.stopPctMed, 2) : "–" }] }, 100 + c.avgCostR * 10);
    }
  }

  if (n >= DIAG.minForAverages) {
    const p = d.payoff;
    const ex = d.excursion;
    // — quick stops
    if (ex.quickStopShare != null && ex.quickStopShare >= DIAG.quickStopShare && ex.stopLosses >= 8) {
      const atrNote =
        ex.stopAtrMed == null ? "" : ex.stopAtrMed < 1 ? ` Der Stop lag im Median bei ${dec(ex.stopAtrMed, 2)} × ATR(14) – evtl. enger als die typische Schwankung.` : ` Der Stop lag im Median bei ${dec(ex.stopAtrMed, 2)} × ATR(14); eng im Verhältnis zur Schwankung ist er damit nicht – eher passen Zeitpunkt oder Richtung der Einstiege nicht.`;
      add(
        {
          id: "quick-stops",
          severity: ex.quickStopShare >= 0.65 ? "high" : "medium",
          title: "Viele Stopps gleich nach dem Einstieg",
          text: `${pct(ex.quickStopShare)} der Stopp-Verluste (${ex.quickStopN} von ${ex.stopLosses}) kamen innerhalb von ${DIAG.quickStopBars} Kerzen.${atrNote}`,
          evidence: [{ label: "schnelle Stopps", value: `${ex.quickStopN} von ${ex.stopLosses}` }, { label: "Stop in ATR (Median)", value: ex.stopAtrMed != null ? dec(ex.stopAtrMed, 2) : "–" }, { label: "Stop in % (Median)", value: ex.stopPctMed != null ? pct(ex.stopPctMed, 2) : "–" }],
        },
        600 + ex.quickStopShare * 100,
      );
    }
    // — losers that were in profit
    if (ex.losersReached1R != null && ex.losersReached1R >= DIAG.loserReached1R && s.losses >= 8) {
      const managed = cfg.custom && (cfg.custom.exits.breakEven.on || cfg.custom.exits.trail.on || cfg.custom.exits.partial.on);
      add(
        {
          id: "losers-were-green",
          severity: "medium",
          title: "Verlierer lagen vorher im Plus",
          text: `${pct(ex.losersReached1R)} der Verlierer waren zwischendurch mindestens +1 R im Plus (Median der besten Zwischenstände ${rr(ex.loserMfeMed)}). Das deutet darauf hin, dass Break-even, Trailing oder ein früheres Ziel diese Läufe anders hätten enden lassen können${managed ? " – eine Verwaltung ist hier schon aktiv, siehe den Vergleich unten" : ""}.`,
          evidence: [{ label: "Verlierer ≥ +1 R", value: pct(ex.losersReached1R) }, { label: "Verlierer ≥ +0,5 R", value: ex.losersReachedHalfR != null ? pct(ex.losersReachedHalfR) : "–" }, { label: "Verlierer", value: String(s.losses) }],
        },
        500 + ex.losersReached1R * 100,
      );
    }
    // — target rarely reached
    const targets = fs.filter((x) => x.t.target != null && Math.abs(x.t.entry - x.t.stop) > 0);
    if (targets.length >= 15) {
      const hit = targets.filter((x) => x.t.reason === "target" || (x.t.partials?.length ?? 0) > 0).length / targets.length;
      const tR = median(targets.map((x) => Math.abs(x.t.target! - x.t.entry) / Math.abs(x.t.entry - x.t.stop)));
      if (hit < 0.15 && tR != null && ex.mfeMed != null && ex.mfeMed < tR * 0.6) {
        add({ id: "target-far", severity: "medium", title: "Das Ziel wird selten erreicht", text: `Nur ${pct(hit)} der Trades erreichen das Ziel (Median ${dec(tR, 1)} R); der Kurs lief im Median höchstens ${rr(ex.mfeMed)} in die Richtung des Trades.`, evidence: [{ label: "Ziel erreicht", value: pct(hit) }, { label: "Ziel (Median)", value: rr(tR, 1) }, { label: "Bester Zwischenstand (Median)", value: rr(ex.mfeMed) }] }, 300);
      }
    }
    // — payoff vs win rate
    if (p.winRate != null && p.breakEvenWinRate != null && p.winRate < p.breakEvenWinRate - 0.03) {
      const gap = p.breakEvenWinRate - p.winRate;
      add({ id: "payoff", severity: gap > 0.12 ? "high" : "medium", title: "Win-Rate unter der Break-even-Schwelle", text: `Win-Rate ${pct(p.winRate)} bei Ø Gewinn ${rr(p.avgWinR)} und Ø Verlust ${rr(p.avgLossR)}: erst ab ${pct(p.breakEvenWinRate)} würde sich das tragen.`, evidence: [{ label: "Win-Rate", value: pct(p.winRate) }, { label: "Break-even-Win-Rate", value: pct(p.breakEvenWinRate) }, { label: "Ø Gewinn / Verlust", value: `${rr(p.avgWinR)} / ${rr(p.avgLossR)}` }] }, 450 + gap * 100);
    }
    // — a few trades carry the result
    if (p.top3Share != null && p.medR != null && p.medR < 0 && p.top3Share > 0.7 && n >= 15) {
      add({ id: "few-winners", severity: "medium", title: "Wenige Treffer tragen das Ergebnis", text: `Die drei besten Trades machen ${pct(p.top3Share)} des Gesamtergebnisses aus; der Median-Trade liegt bei ${rr(p.medR)} (Ø ${rr(p.avgR)}). Ohne diese Ausreißer sähe der Lauf deutlich schwächer aus.`, evidence: [{ label: "Top 3", value: pct(p.top3Share) }, { label: "Median R", value: rr(p.medR) }, { label: "Ø R", value: rr(p.avgR) }] }, 350);
    }
    // — exits that end flat or by time
    const timeExits = d.exits.filter((e) => e.reason === "time" || e.reason === "end");
    const tn = sum(timeExits.map((e) => e.n));
    const tAvg = tn ? sum(timeExits.map((e) => e.sumR)) / tn : null;
    if (tn / n >= 0.4 && tAvg != null && tAvg < 0) add({ id: "time-exits", severity: "info", title: "Viele Trades enden per Zeit-Stop", text: `${pct(tn / n)} der Trades (${tn}) enden per Zeit-Stop oder am Fensterende, im Schnitt bei ${rr(tAvg)}. Weder Stop noch Ziel wurden erreicht – der Markt ging in der Zeit nirgendwohin.`, evidence: [{ label: "Zeit-/Ende-Exits", value: `${tn} von ${n}` }, { label: "Ø R dort", value: rr(tAvg) }] }, 150);
    const be = d.exits.find((e) => e.reason === "breakeven");
    if (be && be.share >= 0.25) add({ id: "breakeven-many", severity: "info", title: "Viele Trades enden auf Break-even", text: `${pct(be.share)} der Trades (${be.n}) werden am Break-even-Stop beendet, Ø ${rr(be.avgR)}. Jeder davon kostet nur Gebühren – gewonnen wird dort nichts.`, evidence: [{ label: "Break-even-Exits", value: `${be.n} von ${n}` }, { label: "Ø R", value: rr(be.avgR) }] }, 120);
    // — capped position size (leverage)
    const stopExits = fs.filter((x) => x.t.reason === "stop");
    const capped = stopExits.filter((x) => x.t.r > -0.8);
    if (stopExits.length >= 8 && capped.length / stopExits.length >= 0.2) add({ id: "leverage-cap", severity: "info", title: "Positionsgröße durch den Hebel begrenzt", text: `${capped.length} von ${stopExits.length} Stopps kosteten weniger als −0,8 R: bei engem Stop hätte die Risikogröße mehr als ${cfg.maxLeverage}× Hebel gebraucht, die Position wurde gedeckelt. Das Risiko pro Trade liegt dort unter den eingestellten ${dec(cfg.riskPct, 2)} %.`, evidence: [{ label: "gedeckelte Stopps", value: `${capped.length} von ${stopExits.length}` }, { label: "Max. Hebel", value: `${cfg.maxLeverage}×` }] }, 80);

    // — long vs short
    const sd = d.sides;
    if (sd.length === 2 && sd.every((x) => x.n >= 8) && sd[0]!.avgR != null && sd[1]!.avgR != null && Math.abs(sd[0]!.avgR - sd[1]!.avgR) >= 0.5) {
      const [a, b] = sd as [SideRow, SideRow];
      add({ id: "sides", severity: "info", title: "Long und Short laufen verschieden", text: `${a.side === "long" ? "Long" : "Short"} Ø ${rr(a.avgR)} (${a.n} Trades) gegen ${b.side === "long" ? "Long" : "Short"} Ø ${rr(b.avgR)} (${b.n} Trades). ${n < DIAG.minForSplits ? "Bei dieser Zahl an Trades kann das Zufall sein." : ""}`.trim(), evidence: sd.map((x) => ({ label: x.side === "long" ? "Long" : "Short", value: `${rr(x.avgR)} · n=${x.n}` })) }, 200);
    }
    // — time of day
    if (n >= DIAG.minForSplits) {
      const rows = d.byHour.filter((x) => x.n >= 10 && x.avgR != null);
      if (rows.length >= 2) {
        const worst = rows.reduce((m, x) => (x.avgR! < m.avgR! ? x : m));
        const best = rows.reduce((m, x) => (x.avgR! > m.avgR! ? x : m));
        if (best.avgR! - worst.avgR! >= 0.6) add({ id: "hours", severity: "info", title: "Schwache und starke Tageszeit", text: `Einstiege ${worst.label} Uhr UTC: Ø ${rr(worst.avgR)} (${worst.n} Trades); ${best.label} Uhr UTC: Ø ${rr(best.avgR)} (${best.n} Trades).`, evidence: [{ label: worst.label, value: `${rr(worst.avgR)} · n=${worst.n}` }, { label: best.label, value: `${rr(best.avgR)} · n=${best.n}` }] }, 100);
      }
      const days = d.byWeekday.filter((x) => x.n >= 10 && x.avgR != null);
      if (days.length >= 2) {
        const worst = days.reduce((m, x) => (x.avgR! < m.avgR! ? x : m));
        const best = days.reduce((m, x) => (x.avgR! > m.avgR! ? x : m));
        if (best.avgR! - worst.avgR! >= 0.7) add({ id: "weekdays", severity: "info", title: "Schwache und starke Wochentage", text: `${worst.label}: Ø ${rr(worst.avgR)} (${worst.n} Trades); ${best.label}: Ø ${rr(best.avgR)} (${best.n} Trades).`, evidence: [{ label: worst.label, value: `${rr(worst.avgR)} · n=${worst.n}` }, { label: best.label, value: `${rr(best.avgR)} · n=${best.n}` }] }, 90);
      }
    }
    // — drawdown
    if (s.maxDD >= 0.25) add({ id: "drawdown", severity: "info", title: "Tiefer Drawdown", text: `Der größte Rückgang liegt bei ${pct(s.maxDD)} des Kapitals, die längste Verlustserie bei ${s.longestLosing} Trades – bei ${dec(cfg.riskPct, 2)} % Risiko pro Trade.`, evidence: [{ label: "Max. Drawdown", value: pct(s.maxDD) }, { label: "Längste Verlustserie", value: String(s.longestLosing) }] }, 70);
  }

  // — engine-level honesty
  if (n >= 1 && d.ambiguous.share != null && d.ambiguous.share >= DIAG.ambiguousShare && n >= DIAG.minForAverages) {
    add({ id: "ambiguous", severity: "medium", title: "Stop und Ziel in derselben Kerze", text: `Bei ${d.ambiguous.n} von ${n} Trades (${pct(d.ambiguous.share)}) lagen der Stop und ein Take-Profit in der Stop-Kerze. Die Engine kennt die Reihenfolge nicht und wertet den Stop – das Ergebnis ist hier eher zu pessimistisch. Eine kleinere Ausführungs-Zeitebene würde es genauer machen.`, evidence: [{ label: "betroffene Trades", value: `${d.ambiguous.n} von ${n}` }] }, 250 + d.ambiguous.share * 100);
  }
  const f = r.funnel;
  if (f.signals > 0 && (f.skippedGap + f.skippedRisk) / f.signals >= DIAG.skippedShare && f.signals >= 5) {
    add({ id: "skipped", severity: "medium", title: "Signale bei der Ausführung verworfen", text: `${f.skippedGap + f.skippedRisk} von ${f.signals} Signalen wurden nicht eröffnet: ${f.skippedGap}× lag die nächste Eröffnung schon hinter Stop oder Ziel, ${f.skippedRisk}× war der Stop zu eng oder die Größe nicht möglich.`, evidence: [{ label: "verworfen", value: `${f.skippedGap + f.skippedRisk} von ${f.signals}` }] }, 300);
  }
  if (f.candidates != null && f.blockedByPosition != null && f.candidates >= 10 && f.blockedByPosition / f.candidates >= DIAG.blockedShare) {
    add({ id: "blocked", severity: "info", title: "Die Position ist meist schon belegt", text: `${pct(f.blockedByPosition / f.candidates)} der gültigen Signale (${f.blockedByPosition} von ${f.candidates}) kamen, während ein Trade offen war – es zählt immer nur eine Position. Trades dauern im Schnitt ${s.avgBars != null ? dec(s.avgBars, 1) : "–"} Kerzen.`, evidence: [{ label: "bei offener Position", value: `${f.blockedByPosition} von ${f.candidates}` }] }, 110);
  }
  if (f.conflicts) add({ id: "conflicts", severity: "info", title: "Long und Short zugleich", text: `${f.conflicts}× fielen Long- und Short-Signal auf dieselbe Kerze; dann wird nicht gehandelt.`, evidence: [{ label: "Konflikte", value: String(f.conflicts) }] }, 60);
  // — rule bottlenecks (custom)
  const totalBars = Math.max(1, f.examined);
  if (f.nodes.length && n > 0) {
    for (const x of f.nodes.filter((y) => y.kind === "leaf" && y.u / totalBars >= 0.3).slice(0, 2)) add({ id: `unknown-${x.id}`, severity: "medium", title: "Eine Bedingung hat zu wenig Daten", text: `„${x.label}“ war in ${pct(x.u / totalBars)} der Kerzen unbekannt (zu wenig Daten) und konnte dort nie erfüllt werden.`, evidence: [{ label: "unbekannt", value: `${cnt(x.u)} von ${cnt(totalBars)}` }] }, 280);
    const leaves = f.nodes.filter((y) => y.kind === "leaf");
    if (leaves.length >= 2) {
      const tight = leaves.reduce((m, x) => (x.t < m.t ? x : m));
      add({ id: "tightest", severity: "info", title: "Engste Bedingung", text: `„${tight.label}“ ist die seltenste Bedingung: in ${pct(tight.t / totalBars, 1)} der Kerzen erfüllt${tight.u ? ` (${pct(tight.u / totalBars)} unbekannt)` : ""}.`, evidence: [{ label: "erfüllt", value: `${cnt(tight.t)} von ${cnt(totalBars)}` }] }, 40);
    }
  }
  // — data
  const cov = d.coverage;
  if (cov.missing > 0 && cov.expected > 0 && cov.missing / cov.expected >= DIAG.missingShare) add({ id: "gaps", severity: "medium", title: "Lücken in den Kerzen", text: `${cnt(cov.missing)} Kerzen fehlen in ${cov.gaps} Lücke${cov.gaps === 1 ? "" : "n"} (${pct(cov.missing / cov.expected, 1)} des Zeitraums). Indikatoren rechnen über die Lücken hinweg.`, evidence: [{ label: "fehlende Kerzen", value: cnt(cov.missing) }] }, 270);
  if (cov.receivedShare != null && cov.receivedShare < 0.9) add({ id: "short-data", severity: "medium", title: "Weniger Kerzen als der Zeitraum verlangt", text: `Gewünscht waren etwa ${cnt(cov.expected)} Kerzen, vorhanden sind ${cnt(cov.received)} (${pct(cov.receivedShare)}). Der Markt war evtl. noch nicht so lange gelistet.`, evidence: [{ label: "erwartet / vorhanden", value: `${cnt(cov.expected)} / ${cnt(cov.received)}` }] }, 260);
  if (!cov.warmupOk) add({ id: "warmup", severity: "medium", title: "Zu kurzes Warm-up", text: `Die Strategie wollte ${cnt(cov.warmupWanted)} Kerzen Vorlauf, gefunden wurden ${cnt(cov.warmupGot)}. Frühe Signale beruhen auf eingeschwungenen Indikatoren nur teilweise.`, evidence: [{ label: "Vorlauf gewünscht / gefunden", value: `${cnt(cov.warmupWanted)} / ${cnt(cov.warmupGot)}` }] }, 255);

  // — comparisons (re-runs of the same run)
  const base = d.compare[0]!;
  const small = (v: CompareRow) => v.n < DIAG.minForAverages || base.n < DIAG.minForAverages;
  for (const v of d.compare.slice(1)) {
    if (v.deltaAvgR == null || base.avgR == null || v.avgR == null) continue;
    const note = small(v) ? " (kleine Stichprobe)" : "";
    const nums = `Ø ${rr(v.avgR)} bei ${v.n} Trades statt ${rr(base.avgR)} bei ${base.n}`;
    if (v.kind === "noCosts" && (Math.abs(v.deltaAvgR) >= 0.03 || (v.avgR > 0) !== (base.avgR > 0))) {
      add({ id: "cmp-costs", severity: v.avgR > 0 && base.avgR <= 0 ? "high" : "info", title: "Vergleich ohne Kosten", text: `Ohne Gebühren, Slippage und Funding: ${nums}, Netto ${money(v.net)} statt ${money(base.net)}${note}.`, evidence: [{ label: "ohne Kosten", value: `${rr(v.avgR)} · n=${v.n}` }, { label: "mit Kosten", value: `${rr(base.avgR)} · n=${base.n}` }] }, 700);
    } else if (v.kind === "noLeaf" && Math.abs(v.deltaAvgR) >= 0.15 && v.n >= 5) {
      const better = v.deltaAvgR > 0;
      add({ id: `cmp-${v.id}`, severity: better && !small(v) ? "medium" : "info", title: better ? "Ein Filter kostet Ergebnis" : "Ein Filter trägt", text: `${v.label}: ${nums}${note}. ${better ? "Die Zahlen sprechen dafür, dass dieser Filter hier eher Gewinner aussortiert." : "Der Filter hält hier schlechte Trades fern."}`, evidence: [{ label: "ohne Filter", value: `${rr(v.avgR)} · n=${v.n}` }, { label: "mit Filter", value: `${rr(base.avgR)} · n=${base.n}` }] }, 380 + Math.abs(v.deltaAvgR) * 100);
    } else if (v.kind === "noExits" && Math.abs(v.deltaAvgR) >= 0.1) {
      add({ id: "cmp-exits", severity: "info", title: v.deltaAvgR > 0 ? "Die Verwaltung bremst" : "Die Verwaltung hilft", text: `Ohne Break-even, Trailing, Teilverkauf und Zeit-Stop: ${nums}${note}.`, evidence: [{ label: "ohne Verwaltung", value: `${rr(v.avgR)} · n=${v.n}` }, { label: "mit Verwaltung", value: `${rr(base.avgR)} · n=${base.n}` }] }, 330);
    }
  }
  return out
    .sort((a, b) => SEV[b.severity] - SEV[a.severity] || b.weight - a.weight || a.id.localeCompare(b.id))
    .map(({ weight: _w, ...f2 }) => {
      void _w;
      return f2;
    });
}

// ── entry point ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Diagnosis of a finished lab run. `data.bars` are the run's execution bars (the index space of the trades); without
 * them the excursion figures are `null`. Pure and deterministic: the same inputs give the same JSON.
 */
export function diagnoseRun(result: LabResult, cfg: DiagnoseCfg, data: DiagnoseData): Diagnosis {
  const fs = factsOf(result.trades, data);
  const hourBlock = (t: BtTrade): number => Math.floor(new Date(t.entryTime).getUTCHours() / 4);
  const partial: Omit<Diagnosis, "findings"> = {
    v: DIAGNOSIS_VERSION,
    strategy: result.strategy,
    n: fs.length,
    coverage: coverageOf(result),
    funnel: funnelOf(result),
    costs: costsOf(fs),
    exits: exitsOf(fs),
    sides: sidesOf(fs),
    byHour: bucketsOf(fs, hourBlock, 6, (k) => `${String(k * 4).padStart(2, "0")}–${String(k * 4 + 4).padStart(2, "0")}`),
    byWeekday: bucketsOf(fs, (t) => new Date(t.entryTime).getUTCDay(), 7, (k) => WEEKDAYS[k]!),
    payoff: payoffOf(fs, result.stats.winRate),
    excursion: excursionOf(fs),
    ambiguous: { n: fs.filter((x) => x.t.ambiguous).length, share: fs.length ? fs.filter((x) => x.t.ambiguous).length / fs.length : null },
    sample: sampleOf(fs.length, result),
    compare: compareOf(result),
  };
  return { ...partial, findings: findingsOf(result, cfg, fs, partial) };
}
