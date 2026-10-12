/**
 * Answer engine of the NLQ (P04): executes a parsed `Intent` over the journal with the same building blocks as the
 * rest of the app (`aggregate`, P03 `breakdown` / tests / intervals, the coach's behaviour events) and returns the
 * numbers, a German answer, the evidence trades, a chart spec and an honest confidence. Nothing is estimated: an
 * empty selection says so, a question it cannot place gets the honest fallback.
 */
import type { EnrichedTrade, Settings } from "../../types";
import { aggregate, type Agg } from "../../agg";
import { breakdown, type BreakdownRow } from "../../analytics/breakdowns";
import { DIMENSIONS } from "../../analytics/dimensions";
import { proportionDiff, tTest, welch, wilsonCI, type Interval } from "../../analytics/stats";
import { streaks } from "../../analytics/streaks";
import { holdLabel, holdMs } from "../../excursion";
import { pairKey } from "../../grouping";
import { equityDrawdown } from "../../insights/edge";
import { sessionOf } from "../../insights/time";
import { tradeTime } from "@/lib/dates";
import { pct, pct0, pf as fmtPf, r as fmtR, signed } from "@/lib/format";
import { BEHAVIOR_LABEL, type BehaviorEvent } from "../events";
import { BEHAVIOR_ADVICE, FALLBACK_HELP } from "../copy";
import { behaviorReport, behaviorTrend, triggerOf } from "../behaviors";
import { accountOf, fin, median } from "../shared";
import { METRIC_LABEL, type MetricKey } from "./lexicon";
import { DIM_LABEL, assetBase, type Filter, type Intent, type Period } from "./parse";

export type Tone = "win" | "loss" | "fg" | "mute";
export type ConfidenceLabel = "klar" | "Tendenz" | "zu wenig Daten";

export interface AnswerFact {
  label: string;
  value: string;
  raw: number | null;
  tone: Tone;
}

export interface ChartRow {
  label: string;
  value: number;
  n: number;
  tone: Tone;
  highlight?: boolean;
}

export type ChartSpec = { type: "bars"; unit: "R" | "money" | "pct" | "count" | "ratio"; rows: ChartRow[] } | { type: "line"; label: string; values: number[] };

export interface AnswerConfidence {
  score: number;
  label: ConfidenceLabel;
  n: number;
  note: string;
}

export interface Answer {
  intent: Intent;
  kind: Intent["type"] | "empty";
  title: string;
  text: string;
  facts: AnswerFact[];
  /** evidence trade ids (≤ 6) */
  trades: string[];
  chart: ChartSpec | null;
  confidence: AnswerConfidence;
  followUps: string[];
}

export interface AnswerData {
  /** closed trades of the account view, time order */
  closed: readonly EnrichedTrade[];
  settings: Settings;
  events: readonly BehaviorEvent[];
  now: number;
  currency: string;
  /** start capital of the account view (drawdown) */
  start: number;
}

/* ------------------------------------------------------------------ selection */

function matchFilter(t: EnrichedTrade, f: Filter): boolean {
  switch (f.dim) {
    case "side":
      return (t.side === "short" ? "short" : "long") === f.value;
    case "account":
      return accountOf(t) === f.value;
    case "weekday":
      return String((tradeTime(t).getDay() + 6) % 7) === f.value;
    case "session":
      return sessionOf(tradeTime(t)) === f.value;
    case "setup":
      return (t.setups ?? []).includes(f.value);
    case "asset":
      return assetBase(pairKey(t.pair || "")) === f.value;
    case "result":
      return t.result === f.value;
    case "emotion":
      return t.emotion === f.value;
    case "timeframe":
      return (t.timeframe ?? "").toLowerCase() === f.value.toLowerCase();
    case "tag":
      return Array.isArray(t.tags) && t.tags.some((x) => x.toLowerCase() === f.value.toLowerCase());
    case "conviction":
    case "leverage": {
      const v = f.dim === "conviction" ? t.conviction : t.leverage;
      if (!fin(v) || f.num == null) return false;
      switch (f.op) {
        case ">=":
          return v >= f.num;
        case "<=":
          return v <= f.num;
        case ">":
          return v > f.num;
        case "<":
          return v < f.num;
        default:
          return v === f.num;
      }
    }
  }
}

const inPeriod = (t: EnrichedTrade, p: Period | null): boolean => {
  if (!p) return true;
  const ms = +tradeTime(t);
  return ms >= p.from && ms < p.to;
};

/** Closed trades matching every filter and the period. */
export function selectTrades(closed: readonly EnrichedTrade[], filters: readonly Filter[], period: Period | null): EnrichedTrade[] {
  return closed.filter((t) => inPeriod(t, period) && filters.every((f) => matchFilter(t, f)));
}

/* ------------------------------------------------------------------ formatting */

const money = (v: number | null | undefined, cur: string): string => `${signed(v, 0)} ${cur}`;
const toneOf = (v: number | null | undefined): Tone => (v == null || !Number.isFinite(v) || v === 0 ? "mute" : v > 0 ? "win" : "loss");

/** Confidence from the sample size alone (simple metrics). */
export function sampleConfidence(n: number, note = ""): AnswerConfidence {
  const score = Math.round(100 * (1 - Math.exp(-n / 25)));
  const label: ConfidenceLabel = n >= 30 ? "klar" : n >= 10 ? "Tendenz" : "zu wenig Daten";
  return { score, label, n, note: note || (n >= 30 ? `${n} Trades – belastbar.` : n >= 10 ? `${n} Trades – eine Tendenz, noch kein Beweis.` : `Nur ${n} Trade${n === 1 ? "" : "s"} – zu wenig für eine Aussage.`) };
}

/** Confidence of a test result (p) blended with the sample size. */
function testConfidence(n: number, p: number | null, note: string): AnswerConfidence {
  const size = 1 - Math.exp(-n / 25);
  const sig = p == null ? 0 : Math.max(0, Math.min(1, 1 - p / 0.3));
  const score = Math.round(100 * (0.55 * sig + 0.45 * size));
  const label: ConfidenceLabel = p != null && p < 0.05 && n >= 20 ? "klar" : p != null && p < 0.2 && n >= 10 ? "Tendenz" : "zu wenig Daten";
  return { score, label, n, note };
}

interface MetricResult {
  value: number | null;
  text: string;
  tone: Tone;
  ci?: Interval | null;
  /** trade that is the answer (best / worst) */
  trade?: EnrichedTrade | null;
}

/** Value of a metric over a set of closed trades. */
export function metricValue(metric: MetricKey, trades: readonly EnrichedTrade[], g: Agg, data: Pick<AnswerData, "currency" | "start">): MetricResult {
  const cur = data.currency;
  switch (metric) {
    case "net":
      return { value: g.net, text: money(g.net, cur), tone: toneOf(g.net) };
    case "winRate": {
      const decisive = g.wins + g.losses;
      return { value: g.winRate, text: pct0(g.winRate), tone: g.winRate == null ? "mute" : "fg", ci: decisive ? wilsonCI(g.wins, g.n) : null };
    }
    case "pf":
      return { value: g.pf, text: fmtPf(g.pf), tone: g.pf == null ? "mute" : g.pf >= 1 ? "win" : "loss" };
    case "avgR": {
      const rs = trades.map((t) => t.r).filter(fin);
      const tt = rs.length >= 2 ? tTest(rs) : null;
      return { value: g.avgR, text: fmtR(g.avgR), tone: toneOf(g.avgR), ci: tt?.ci ?? null };
    }
    case "expectancy": {
      const xs = trades.map((t) => t.pnl ?? 0);
      const tt = xs.length >= 2 ? tTest(xs) : null;
      return { value: g.exp, text: money(g.exp, cur), tone: toneOf(g.exp), ci: tt?.ci ?? null };
    }
    case "count":
      return { value: g.n, text: `${g.n}`, tone: "fg" };
    case "fees":
      return { value: g.fees, text: `${signed(-Math.abs(g.fees), 0)} ${cur}`, tone: g.fees ? "loss" : "mute" };
    case "maxDD": {
      const dd = equityDrawdown(trades, data.start);
      return { value: dd.maxDD, text: pct(dd.maxDD), tone: dd.maxDD < 0 ? "loss" : "mute" };
    }
    case "avgWin":
      return { value: g.avgWin, text: money(g.avgWin, cur), tone: g.avgWin == null ? "mute" : "win" };
    case "avgLoss":
      return { value: g.avgLoss, text: money(g.avgLoss, cur), tone: g.avgLoss == null ? "mute" : "loss" };
    case "best":
      return { value: g.best?.pnl ?? null, text: g.best ? `${money(g.best.pnl, cur)}${fin(g.best.r) ? ` (${fmtR(g.best.r)})` : ""}` : "–", tone: toneOf(g.best?.pnl), trade: g.best };
    case "worst":
      return { value: g.worst?.pnl ?? null, text: g.worst ? `${money(g.worst.pnl, cur)}${fin(g.worst.r) ? ` (${fmtR(g.worst.r)})` : ""}` : "–", tone: toneOf(g.worst?.pnl), trade: g.worst };
    case "hold": {
      const hs = trades.map((t) => holdMs({ date: t.date, exitDate: t.exitDate, createdAt: t.createdAt })).filter(fin);
      const m = median(hs);
      return { value: m, text: m == null ? "–" : holdLabel(m), tone: m == null ? "mute" : "fg" };
    }
    case "streak": {
      const st = streaks(trades.map((t) => t.result));
      return { value: st.longestLoss, text: `${st.longestWin} Gewinne / ${st.longestLoss} Verluste`, tone: "fg" };
    }
    case "payoff":
      return { value: g.payoff, text: g.payoff == null ? "–" : g.payoff.toFixed(2).replace(".", ","), tone: g.payoff == null ? "mute" : g.payoff >= 1 ? "win" : "fg" };
    case "sumR": {
      const rs = trades.map((t) => t.r).filter(fin);
      const s = rs.reduce((a, b) => a + b, 0);
      return { value: rs.length ? s : null, text: rs.length ? fmtR(s) : "–", tone: toneOf(s) };
    }
  }
}

const scopeText = (intent: Intent, filters: readonly Filter[] = intent.filters): string => {
  const parts = [...filters.map((f) => f.label), ...(intent.period ? [intent.period.label] : [])];
  return parts.length ? parts.join(" · ") : "Alle Trades";
};

const newestIds = (ts: readonly EnrichedTrade[], k = 6): string[] => [...ts].sort((a, b) => +tradeTime(b) - +tradeTime(a)).slice(0, k).map((t) => t.id);
const biggestIds = (ts: readonly EnrichedTrade[], k = 6): string[] => [...ts].sort((a, b) => Math.abs(b.pnl ?? 0) - Math.abs(a.pnl ?? 0)).slice(0, k).map((t) => t.id);

function equityLine(trades: readonly EnrichedTrade[]): number[] {
  const out: number[] = [0];
  let s = 0;
  for (const t of trades) out.push((s += t.pnl ?? 0));
  return out;
}

const baseFacts = (g: Agg, cur: string): AnswerFact[] => [
  { label: "Trades", value: `${g.n}`, raw: g.n, tone: "fg" },
  { label: "Netto", value: money(g.net, cur), raw: g.net, tone: toneOf(g.net) },
  { label: "Win-Rate", value: pct0(g.winRate), raw: g.winRate, tone: "fg" },
  { label: "Ø R", value: fmtR(g.avgR), raw: g.avgR, tone: toneOf(g.avgR) },
];

/* ------------------------------------------------------------------ answers */

function empty(intent: Intent): Answer {
  return {
    intent,
    kind: "empty",
    title: scopeText(intent),
    text: `Für ${scopeText(intent)} gibt es keine abgeschlossenen Trades.`,
    facts: [],
    trades: [],
    chart: null,
    confidence: { score: 0, label: "zu wenig Daten", n: 0, note: "Keine Trades in dieser Auswahl." },
    followUps: ["Wie war letzte Woche?", "Was ist mein bestes Setup?"],
  };
}

function metricAnswer(intent: Intent, data: AnswerData): Answer {
  const ts = selectTrades(data.closed, intent.filters, intent.period);
  if (!ts.length) return empty(intent);
  const g = aggregate(ts);
  const m = metricValue(intent.metric, ts, g, data);
  const scope = scopeText(intent);
  const label = METRIC_LABEL[intent.metric];
  let text = `${label} (${scope}): ${m.text} aus ${g.n} Trade${g.n === 1 ? "" : "s"}.`;
  if (m.ci && intent.metric === "winRate") text += ` Ehrliche Spanne: ${pct0(m.ci.lo)} bis ${pct0(m.ci.hi)}.`;
  else if (m.ci && intent.metric === "avgR") text += ` Spanne (80 %): ${fmtR(m.ci.lo)} bis ${fmtR(m.ci.hi)}.`;
  else if (m.ci && intent.metric === "expectancy") text += ` Spanne (80 %): ${money(m.ci.lo, data.currency)} bis ${money(m.ci.hi, data.currency)}.`;
  if (m.trade) text = `${label} (${scope}): ${m.text} am ${tradeTime(m.trade).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" })}${m.trade.pair ? ` · ${m.trade.pair}` : ""}.`;
  const facts: AnswerFact[] = [{ label, value: m.text, raw: m.value, tone: m.tone }, ...baseFacts(g, data.currency).filter((f) => f.label !== label && !(intent.metric === "net" && f.label === "Netto") && !(intent.metric === "count" && f.label === "Trades"))];
  const conf = sampleConfidence(g.n);
  const chart: ChartSpec | null = ts.length >= 3 && ["net", "expectancy", "sumR", "maxDD", "count"].includes(intent.metric) ? { type: "line", label: "Kumuliertes P&L", values: equityLine(ts) } : null;
  return {
    intent,
    kind: "metric",
    title: `${label} · ${scope}`,
    text,
    facts,
    trades: m.trade ? [m.trade.id, ...biggestIds(ts.filter((t) => t !== m.trade), 3)] : biggestIds(ts),
    chart,
    confidence: m.trade ? { ...conf, note: `Aus ${g.n} Trades gewählt.` } : conf,
    followUps: [`${label} pro Setup`, `${label} letzte Woche`, `${label} pro Session`].filter((q) => q.toLowerCase() !== intent.raw.toLowerCase()),
  };
}

const ROW_MIN = 3;

function rowMetric(metric: MetricKey, row: BreakdownRow): number | null {
  switch (metric) {
    case "winRate":
      return row.g.winRate;
    case "avgR":
      return row.expR.mean;
    case "expectancy":
      return row.exp.mean;
    case "count":
      return row.g.n;
    case "pf":
      return row.g.pf === Infinity ? null : row.g.pf;
    case "fees":
      return -Math.abs(row.g.fees);
    case "sumR":
      return row.expR.mean != null ? row.expR.mean * row.expR.n : null;
    default:
      return row.g.net;
  }
}

const VERDICT_SCORE: Record<string, number> = { klar: 85, tendenz: 60, offen: 35, wenig: 15 };

function groupAnswer(intent: Intent, data: AnswerData): Answer {
  const ts = selectTrades(data.closed, intent.filters, intent.period);
  if (!ts.length) return empty(intent);
  const dim = intent.groupBy!;
  const bd = breakdown(ts, dim, { settings: data.settings }, { minN: 5 });
  const metric: MetricKey = ["best", "worst", "hold", "streak", "maxDD", "avgWin", "avgLoss", "payoff"].includes(intent.metric) ? "net" : intent.metric;
  const rows = bd.rows.filter((r) => !r.none).map((r) => ({ r, v: rowMetric(metric, r) })).filter((x): x is { r: BreakdownRow; v: number } => x.v != null && Number.isFinite(x.v));
  if (!rows.length) return { ...empty(intent), text: `Keine Trades mit ${DIM_LABEL[dim]}-Angabe in ${scopeText(intent)}.` };
  const ranked = rows.filter((x) => x.r.g.n >= ROW_MIN);
  const pool = ranked.length ? ranked : rows;
  const worst = intent.sort === "worst";
  const top = [...pool].sort((a, b) => (worst ? a.v - b.v : b.v - a.v) || b.r.g.n - a.r.g.n)[0]!;
  const fmt = (v: number): string => (metric === "winRate" ? pct0(v) : metric === "avgR" || metric === "sumR" ? fmtR(v) : metric === "count" ? `${v}` : metric === "pf" ? fmtPf(v) : money(v, data.currency));
  const label = METRIC_LABEL[metric];
  const head = `${worst ? "Am schwächsten" : "Am stärksten"} nach ${label}: ${top.r.label} mit ${fmt(top.v)} (${top.r.g.n} Trades).`;
  const sig = top.r.test.verdict;
  const tail = sig === "klar" ? " Der Unterschied zum Rest hält dem Zufall stand." : sig === "tendenz" ? " Eine Tendenz – noch nicht sicher." : top.r.g.n < 5 ? " Achtung: sehr kleine Stichprobe." : " Statistisch noch offen.";
  const unit: "R" | "money" | "pct" | "count" | "ratio" = metric === "winRate" ? "pct" : metric === "avgR" || metric === "sumR" ? "R" : metric === "count" ? "count" : metric === "pf" ? "ratio" : "money";
  const chartRows: ChartRow[] = [...rows]
    .sort((a, b) => (DIMENSIONS[dim].order ? 0 : b.v - a.v))
    .slice(0, 12)
    .map((x) => ({ label: x.r.label, value: x.v, n: x.r.g.n, tone: metric === "winRate" || metric === "count" ? "fg" : toneOf(x.v), highlight: x.r === top.r }));
  const size = 1 - Math.exp(-top.r.g.n / 25);
  const score = Math.round(0.6 * (VERDICT_SCORE[sig] ?? 15) + 40 * size);
  const confLabel: ConfidenceLabel = sig === "klar" ? "klar" : sig === "tendenz" ? "Tendenz" : "zu wenig Daten";
  return {
    intent,
    kind: "group",
    title: `${label} pro ${DIM_LABEL[dim]}`,
    text: head + tail,
    facts: [
      { label: worst ? "Schwächste Gruppe" : "Stärkste Gruppe", value: top.r.label, raw: null, tone: worst ? "loss" : "win" },
      { label, value: fmt(top.v), raw: top.v, tone: unit === "pct" || unit === "count" ? "fg" : toneOf(top.v) },
      { label: "Trades", value: `${top.r.g.n}`, raw: top.r.g.n, tone: "fg" },
      { label: "Win-Rate", value: pct0(top.r.g.winRate), raw: top.r.g.winRate, tone: "fg" },
    ],
    trades: biggestIds(top.r.trades),
    chart: { type: "bars", unit, rows: chartRows },
    confidence: { score, label: confLabel, n: top.r.g.n, note: `Test gegen den Rest, FDR-korrigiert über ${bd.rows.length} Gruppen.` },
    followUps: [worst ? `Bestes ${DIM_LABEL[dim]}` : `Schwächstes ${DIM_LABEL[dim]}`, `Win-Rate pro ${DIM_LABEL[dim]}`, `Ø R pro ${DIM_LABEL[dim]}`],
  };
}

function compareAnswer(intent: Intent, data: AnswerData): Answer {
  let a: EnrichedTrade[];
  let b: EnrichedTrade[];
  let la: string;
  let lb: string;
  if (intent.compare) {
    a = selectTrades(data.closed, [...intent.filters, intent.compare[0]], intent.period);
    b = selectTrades(data.closed, [...intent.filters, intent.compare[1]], intent.period);
    la = intent.compare[0].label;
    lb = intent.compare[1].label;
  } else {
    a = selectTrades(data.closed, intent.filters, intent.period);
    b = selectTrades(data.closed, intent.filters, intent.period2);
    la = intent.period?.label ?? "A";
    lb = intent.period2?.label ?? "B";
  }
  if (!a.length && !b.length) return empty(intent);
  const ga = aggregate(a);
  const gb = aggregate(b);
  const metric: MetricKey = intent.metricExplicit && !["best", "worst", "hold", "streak", "maxDD"].includes(intent.metric) ? intent.metric : "net";
  const ma = metricValue(metric, a, ga, data);
  const mb = metricValue(metric, b, gb, data);
  let p: number | null;
  if (metric === "winRate" && ga.n && gb.n) p = proportionDiff(ga.wins, ga.n, gb.wins, gb.n)?.p ?? null;
  else {
    const xa = (metric === "avgR" || metric === "sumR" ? a.map((t) => t.r) : a.map((t) => t.pnl ?? 0)).filter(fin);
    const xb = (metric === "avgR" || metric === "sumR" ? b.map((t) => t.r) : b.map((t) => t.pnl ?? 0)).filter(fin);
    p = welch(xa, xb)?.p ?? null;
  }
  const label = METRIC_LABEL[metric];
  const better = (ma.value ?? -Infinity) === (mb.value ?? -Infinity) ? null : (ma.value ?? -Infinity) > (mb.value ?? -Infinity) ? la : lb;
  const n = Math.min(ga.n, gb.n);
  const conf = testConfidence(n, p, p == null ? "Zu wenige Trades für einen Test." : p < 0.05 ? "Der Unterschied ist statistisch klar." : p < 0.2 ? "Eine Tendenz – noch kein Beweis." : "Der Unterschied kann Zufall sein.");
  const text = `${la}: ${ma.text} (${ga.n} Trades) gegen ${lb}: ${mb.text} (${gb.n} Trades). ${better ? `${better} liegt vorn.` : "Gleichauf."} ${conf.note}`;
  const unit: "R" | "money" | "pct" | "count" | "ratio" = metric === "winRate" ? "pct" : metric === "avgR" || metric === "sumR" ? "R" : metric === "count" ? "count" : metric === "pf" ? "ratio" : "money";
  return {
    intent,
    kind: "compare",
    title: `${la} vs. ${lb}`,
    text,
    facts: [
      { label: `${label} ${la}`, value: ma.text, raw: ma.value, tone: ma.tone },
      { label: `${label} ${lb}`, value: mb.text, raw: mb.value, tone: mb.tone },
      { label: `Win-Rate ${la}`, value: pct0(ga.winRate), raw: ga.winRate, tone: "fg" },
      { label: `Win-Rate ${lb}`, value: pct0(gb.winRate), raw: gb.winRate, tone: "fg" },
    ],
    trades: [...biggestIds(a, 3), ...biggestIds(b, 3)],
    chart: { type: "bars", unit, rows: [{ label: la, value: ma.value ?? 0, n: ga.n, tone: unit === "pct" ? "fg" : toneOf(ma.value), highlight: better === la }, { label: lb, value: mb.value ?? 0, n: gb.n, tone: unit === "pct" ? "fg" : toneOf(mb.value), highlight: better === lb }] },
    confidence: conf,
    followUps: [`Win-Rate ${la} vs ${lb}`, `Ø R ${la} vs ${lb}`].filter((q) => q !== intent.raw),
  };
}

function behaviorAnswer(intent: Intent, data: AnswerData): Answer {
  const key = intent.behavior!;
  const ts = selectTrades(data.closed, intent.filters, intent.period);
  const rep = behaviorReport(data.events, ts);
  const st = rep.stats.find((s) => s.key === key);
  const name = BEHAVIOR_LABEL[key];
  const adv = BEHAVIOR_ADVICE[key];
  if (!st) {
    return {
      intent,
      kind: "behavior",
      title: name,
      text: `Keine ${name}-Muster in ${scopeText(intent)} gefunden. ${ts.length ? "Weiter so." : ""}`.trim(),
      facts: [{ label: "Vorkommen", value: "0", raw: 0, tone: "win" }],
      trades: [],
      chart: null,
      confidence: sampleConfidence(ts.length, ts.length ? `Geprüft: ${ts.length} Trades.` : "Keine Trades in dieser Auswahl."),
      followUps: ["Was kostet mich FOMO?", "Wie oft hatte ich Tilt?"].filter((q) => !q.includes(name)),
    };
  }
  const trend = behaviorTrend(data.events, key, data.now, 30 * 86_400_000);
  const r = st.sumR;
  const text = `${name}: ${st.count}× in ${scopeText(intent)}, ${st.trades.length} Trades mit ${money(st.g.net, data.currency)}${r != null ? ` (${fmtR(r)})` : ""}. Gegenüber deinen sauberen Trades: ${money(st.excess, data.currency)}. ${adv.advice}`;
  const weeks: ChartRow[] = [];
  const byMonth = new Map<string, number>();
  for (const e of st.events) {
    const d = new Date(e.at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...byMonth].sort().slice(-8)) weeks.push({ label: `${k.slice(5)}/${k.slice(2, 4)}`, value: v, n: v, tone: "loss" });
  return {
    intent,
    kind: "behavior",
    title: name,
    text,
    facts: [
      { label: "Vorkommen", value: `${st.count}`, raw: st.count, tone: "loss" },
      { label: "P&L dieser Trades", value: money(st.g.net, data.currency), raw: st.g.net, tone: toneOf(st.g.net) },
      { label: "vs. saubere Trades", value: money(st.excess, data.currency), raw: st.excess, tone: toneOf(st.excess) },
      { label: "Letzte 30 Tage", value: `${trend.current} (davor ${trend.previous})`, raw: trend.current, tone: trend.current > trend.previous ? "loss" : trend.current < trend.previous ? "win" : "fg" },
    ],
    trades: newestIds(st.trades),
    chart: weeks.length >= 2 ? { type: "bars", unit: "count", rows: weeks } : null,
    confidence: sampleConfidence(st.trades.length, `${st.trades.length} Trades als Beleg, Regel: ${adv.rule}`),
    followUps: ["Was ist mein bestes Setup?", "Wie war letzte Woche?"],
  };
}

function summaryAnswer(intent: Intent, data: AnswerData): Answer {
  const ts = selectTrades(data.closed, intent.filters, intent.period);
  if (!ts.length) return empty(intent);
  const g = aggregate(ts);
  const scope = scopeText(intent);
  const rep = behaviorReport(data.events, ts);
  const leak = rep.worst;
  let text = `${scope}: ${g.n} Trades, ${money(g.net, data.currency)}, ${pct0(g.winRate)} Win-Rate${g.avgR != null ? `, Ø ${fmtR(g.avgR)}` : ""}.`;
  if (g.best && g.best.pnl && g.best.pnl > 0) text += ` Bester Trade ${money(g.best.pnl, data.currency)}.`;
  if (leak) text += ` Teuerstes Muster: ${leak.label} (${money(leak.excess, data.currency)}).`;
  return {
    intent,
    kind: "summary",
    title: scope,
    text,
    facts: [...baseFacts(g, data.currency), { label: "Profit-Faktor", value: fmtPf(g.pf), raw: g.pf === Infinity ? null : g.pf, tone: g.pf == null ? "mute" : g.pf >= 1 ? "win" : "loss" }],
    trades: biggestIds(ts),
    chart: ts.length >= 2 ? { type: "line", label: "Kumuliertes P&L", values: equityLine(ts) } : null,
    confidence: sampleConfidence(g.n),
    followUps: ["Was ist mein bestes Setup?", "Welche Session ist am profitabelsten?"],
  };
}

function listAnswer(intent: Intent, data: AnswerData): Answer {
  const ts = selectTrades(data.closed, intent.filters, intent.period);
  if (!ts.length) return empty(intent);
  const g = aggregate(ts);
  return {
    intent,
    kind: "list",
    title: scopeText(intent),
    text: `${g.n} Trade${g.n === 1 ? "" : "s"} gefunden (${money(g.net, data.currency)}). Die neuesten ${Math.min(6, g.n)} als Beleg:`,
    facts: baseFacts(g, data.currency),
    trades: newestIds(ts),
    chart: null,
    confidence: sampleConfidence(g.n),
    followUps: ["Wie war letzte Woche?", "Was ist mein bestes Setup?"],
  };
}

function unknownAnswer(intent: Intent): Answer {
  return {
    intent,
    kind: "unknown",
    title: "Nicht verstanden",
    text: FALLBACK_HELP,
    facts: [],
    trades: [],
    chart: null,
    confidence: { score: 0, label: "zu wenig Daten", n: 0, note: "Frage nicht erkannt – nichts geraten." },
    followUps: ["Was ist mein bestes Setup?", "Wie war letzte Woche?", "Vergleiche Long und Short", "Was kostet mich Revenge?"],
  };
}

/** Answers a parsed question over the journal. */
export function answerIntent(intent: Intent, data: AnswerData): Answer {
  if (intent.type !== "unknown" && !data.closed.length) return { ...empty(intent), text: "Noch keine abgeschlossenen Trades – sobald du welche einträgst, beantworte ich Fragen dazu." };
  switch (intent.type) {
    case "metric":
      return metricAnswer(intent, data);
    case "group":
      return groupAnswer(intent, data);
    case "compare":
      return compareAnswer(intent, data);
    case "behavior":
      return behaviorAnswer(intent, data);
    case "list":
      return listAnswer(intent, data);
    case "summary":
      return summaryAnswer(intent, data);
    default:
      return unknownAnswer(intent);
  }
}

/** Ids of the event triggers of a behaviour (helper for the views). */
export const behaviorTradeIds = (events: readonly BehaviorEvent[], key: string): string[] => events.filter((e) => e.key === key).map(triggerOf);
