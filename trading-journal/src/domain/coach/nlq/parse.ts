/**
 * German intent parser (P04 NLQ): turns a question about the own journal into an `Intent` – metric, filters, group-by,
 * period, comparison, sort and behaviour – with the phrases it understood (shown as chips, so the trader sees how the
 * question was read). Rule based and deterministic; anything it cannot place is ignored, and a question without any
 * recognisable part becomes `type: "unknown"` (the answer engine then answers honestly that it did not understand).
 */
import type { Setup } from "../../types";
import type { BehaviorKey } from "../events";
import { BEHAVIOR_LABEL } from "../events";
import {
  ACCOUNT_VALUES,
  ASSET_ALIASES,
  BEHAVIOR_SYNONYMS,
  COMPARE_WORDS,
  DIM_NOUNS,
  EMOTION_VALUES,
  GROUP_TRIGGERS,
  LIST_WORDS,
  METRIC_LABEL,
  METRIC_SYNONYMS,
  MONTH_LABEL,
  MONTH_SHORT,
  MONTHS,
  QUOTE_SUFFIX,
  COMMON_ASSETS,
  RESULT_VALUES,
  SESSION_VALUES,
  SIDE_VALUES,
  SORT_BEST,
  SORT_WORST,
  SUMMARY_WORDS,
  WEEKDAY_VALUES,
  findPhrase,
  firstOf,
  normalize,
  type FilterValue,
  type GroupDim,
  type MetricKey,
} from "./lexicon";

export type FilterDim = "side" | "account" | "weekday" | "session" | "setup" | "asset" | "result" | "emotion" | "conviction" | "leverage" | "timeframe" | "tag";

export interface Filter {
  dim: FilterDim;
  /** value key (setup id, "long", weekday index "0", asset base "BTC", …) */
  value: string;
  label: string;
  /** numeric comparison for conviction / leverage */
  op?: "=" | ">=" | "<=" | ">" | "<";
  num?: number;
  /** position in the normalised question (keeps "A vs B" order) */
  at: number;
}

export type PeriodKind = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "thisYear" | "lastYear" | "lastDays" | "month" | "quarter" | "year" | "all";

export interface Period {
  kind: PeriodKind;
  /** epoch ms, inclusive */
  from: number;
  /** epoch ms, exclusive */
  to: number;
  label: string;
  at: number;
}

export type IntentType = "metric" | "group" | "compare" | "list" | "behavior" | "summary" | "unknown";

export interface Intent {
  raw: string;
  norm: string;
  type: IntentType;
  metric: MetricKey;
  metricExplicit: boolean;
  filters: Filter[];
  period: Period | null;
  /** second period of a period comparison */
  period2: Period | null;
  groupBy: GroupDim | null;
  sort: "best" | "worst" | null;
  /** the two sides of a comparison (filters of the same dimension) */
  compare: [Filter, Filter] | null;
  behavior: BehaviorKey | null;
  /** chips: how the question was read */
  understood: string[];
}

export interface ParseContext {
  setups: readonly Pick<Setup, "id" | "name">[];
  /** asset bases present in the journal ("BTC", "ETH") */
  assets: readonly string[];
  tags?: readonly string[];
  now: number;
}

/* ------------------------------------------------------------------ periods */

const DAY = 86_400_000;
const sod = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const monday = (d: Date): Date => {
  const s = sod(d);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
};

function periodFor(kind: PeriodKind, now: number, at: number, n = 0, year?: number, idx?: number): Period {
  const d = new Date(now);
  const today = sod(d);
  switch (kind) {
    case "today":
      return { kind, from: +today, to: +today + DAY, label: "Heute", at };
    case "yesterday":
      return { kind, from: +today - DAY, to: +today, label: "Gestern", at };
    case "thisWeek": {
      const m = monday(d);
      return { kind, from: +m, to: +new Date(m.getFullYear(), m.getMonth(), m.getDate() + 7), label: "Diese Woche", at };
    }
    case "lastWeek": {
      const m = monday(d);
      const from = new Date(m.getFullYear(), m.getMonth(), m.getDate() - 7);
      return { kind, from: +from, to: +m, label: "Letzte Woche", at };
    }
    case "thisMonth":
      return { kind, from: +new Date(d.getFullYear(), d.getMonth(), 1), to: +new Date(d.getFullYear(), d.getMonth() + 1, 1), label: "Dieser Monat", at };
    case "lastMonth":
      return { kind, from: +new Date(d.getFullYear(), d.getMonth() - 1, 1), to: +new Date(d.getFullYear(), d.getMonth(), 1), label: "Letzter Monat", at };
    case "thisYear":
      return { kind, from: +new Date(d.getFullYear(), 0, 1), to: +new Date(d.getFullYear() + 1, 0, 1), label: `${d.getFullYear()}`, at };
    case "lastYear":
      return { kind, from: +new Date(d.getFullYear() - 1, 0, 1), to: +new Date(d.getFullYear(), 0, 1), label: `${d.getFullYear() - 1}`, at };
    case "lastDays":
      return { kind, from: +today - (n - 1) * DAY, to: +today + DAY, label: `Letzte ${n} Tage`, at };
    case "month": {
      const y = year ?? (idx! <= d.getMonth() ? d.getFullYear() : d.getFullYear() - 1);
      return { kind, from: +new Date(y, idx!, 1), to: +new Date(y, idx! + 1, 1), label: `${MONTH_LABEL[idx!]} ${y}`, at };
    }
    case "quarter": {
      const y = year ?? (idx! * 3 <= d.getMonth() ? d.getFullYear() : d.getFullYear() - 1);
      return { kind, from: +new Date(y, idx! * 3, 1), to: +new Date(y, idx! * 3 + 3, 1), label: `Q${idx! + 1} ${y}`, at };
    }
    case "year":
      return { kind, from: +new Date(year!, 0, 1), to: +new Date(year! + 1, 0, 1), label: `${year}`, at };
    case "all":
      return { kind, from: -Infinity, to: Infinity, label: "Gesamt", at };
  }
}

const PERIOD_WORDS: readonly [PeriodKind, string[]][] = [
  ["today", ["heute", "heutigen tag", "today"]],
  ["yesterday", ["gestern", "gestrigen tag"]],
  ["thisWeek", ["diese woche", "dieser woche", "diesen woche", "in dieser woche", "aktuelle woche", "laufende woche", "this week"]],
  ["lastWeek", ["letzte woche", "letzten woche", "letzter woche", "vorige woche", "vorigen woche", "vergangene woche", "vergangenen woche", "vorwoche", "last week"]],
  ["thisMonth", ["diesen monat", "dieser monat", "diesem monat", "in diesem monat", "aktueller monat", "aktuellen monat", "laufenden monat", "this month"]],
  ["lastMonth", ["letzten monat", "letzter monat", "letztem monat", "vormonat", "vorigen monat", "vorigem monat", "vergangenen monat", "vergangenem monat", "last month"]],
  ["thisYear", ["dieses jahr", "diesem jahr", "in diesem jahr", "ytd", "seit jahresbeginn", "laufendes jahr", "this year"]],
  ["lastYear", ["letztes jahr", "letzten jahr", "letztem jahr", "vorjahr", "vergangenes jahr", "vergangenen jahr", "last year"]],
  ["all", ["insgesamt", "gesamt", "seit beginn", "alle zeit", "bisher", "ueberhaupt", "all time", "jemals"]],
].map(([k, xs]) => [k as PeriodKind, (xs as string[]).map((x) => normalize(x).trim()).sort((a, b) => b.length - a.length)] as [PeriodKind, string[]]);

/** All periods mentioned, in the order they appear. */
export function parsePeriods(norm: string, now: number): Period[] {
  const out: Period[] = [];
  const taken: [number, number][] = [];
  const free = (at: number, len: number) => !taken.some(([a, b]) => at < b && at + len > a);
  const push = (p: Period, len: number) => {
    if (!free(p.at, len)) return;
    taken.push([p.at, p.at + len]);
    out.push(p);
  };
  // "letzte(n) 30 Tage / 4 Wochen / 3 Monate", "seit 14 Tagen"
  for (const m of norm.matchAll(/ (?:letzte|letzten|vergangene|vergangenen|seit|in den letzten) (\d{1,3}) (tage|tagen|wochen|woche|monate|monaten|monat)(?= )/g)) {
    const n = Number(m[1]);
    const unit = m[2]!;
    const days = unit.startsWith("tag") ? n : unit.startsWith("woche") ? n * 7 : n * 30;
    if (n > 0 && n <= 999) push({ ...periodFor("lastDays", now, m.index!, days), label: unit.startsWith("tag") ? `Letzte ${n} Tage` : unit.startsWith("woche") ? `Letzte ${n} Wochen` : `Letzte ${n} Monate` }, m[0].length);
  }
  for (const [kind, list] of PERIOD_WORDS) {
    for (const p of list) {
      const at = findPhrase(norm, p);
      if (at >= 0) push(periodFor(kind, now, at), p.length + 2);
    }
  }
  // quarters: "q3", "q3 2026", "drittes quartal"
  for (const m of norm.matchAll(/ q([1-4])(?: (20\d\d))?(?= )/g)) push(periodFor("quarter", now, m.index!, 0, m[2] ? Number(m[2]) : undefined, Number(m[1]) - 1), m[0].length);
  const QWORDS = ["erste", "zweite", "dritte", "vierte"];
  for (const m of norm.matchAll(/ (erste|ersten|zweite|zweiten|dritte|dritten|vierte|vierten)s? quartal(?: (20\d\d))?(?= )/g)) {
    const q = QWORDS.findIndex((w) => m[1]!.startsWith(w));
    if (q >= 0) push(periodFor("quarter", now, m.index!, 0, m[2] ? Number(m[2]) : undefined, q), m[0].length);
  }
  // months: "september", "im september 2025", "sep"
  MONTHS.forEach((name, i) => {
    for (const w of [name, MONTH_SHORT[i]!]) {
      const re = new RegExp(` ${w}(?: (20\\d\\d))?(?= )`, "g");
      for (const m of norm.matchAll(re)) push(periodFor("month", now, m.index!, 0, m[1] ? Number(m[1]) : undefined, i), m[0].length);
    }
  });
  // bare years "2025"
  for (const m of norm.matchAll(/ (20\d\d)(?= )/g)) push(periodFor("year", now, m.index!, 0, Number(m[1])), m[0].length);
  return out.sort((a, b) => a.at - b.at);
}

/* ------------------------------------------------------------------ filters */

function valueFilters(norm: string, dim: FilterDim, values: readonly FilterValue[]): Filter[] {
  const out: Filter[] = [];
  for (const v of values) {
    const hit = firstOf(norm, v.syn);
    if (hit) out.push({ dim, value: v.value, label: v.label, at: hit.at });
  }
  return out;
}

/**
 * Words that already mean something in another dimension ("makro" / "scalp" = account, "long" / "short" = side,
 * sessions, weekdays, results, feelings): a setup is never found by one of them alone – "Vergleiche Scalp und Makro"
 * compares the two accounts and does not also filter on every setup with "Makro" in its name (Review F09).
 */
const LEXICON_WORDS: ReadonlySet<string> = new Set(
  [SIDE_VALUES, ACCOUNT_VALUES, WEEKDAY_VALUES, SESSION_VALUES, RESULT_VALUES, EMOTION_VALUES].flatMap((vs) => vs.flatMap((v) => v.syn.flatMap((x) => x.split(" ")))),
);

/** Setups named in the question; `spans` = where a WHOLE setup name stands (its words belong to the name). */
function setupFilters(norm: string, setups: ParseContext["setups"]): { filters: Filter[]; spans: Array<[number, number]> } {
  const out: Filter[] = [];
  const spans: Array<[number, number]> = [];
  for (const s of setups) {
    const name = normalize(s.name).trim();
    if (!name) continue;
    let at = findPhrase(norm, name);
    if (at >= 0) spans.push([at, at + name.length + 1]);
    else {
      // a distinctive word of the name (≥ 4 letters, not a generic word, not a word of another dimension)
      for (const w of name.split(" ")) {
        if (w.length < 4 || ["setup", "trade", "trades", "long", "short", "nur", "mit", "ohne"].includes(w) || LEXICON_WORDS.has(w)) continue;
        const a = findPhrase(norm, w);
        if (a >= 0) {
          at = a;
          break;
        }
      }
    }
    if (at >= 0) out.push({ dim: "setup", value: s.id, label: s.name, at });
  }
  return { filters: out, spans };
}

function assetFilters(norm: string, assets: readonly string[]): Filter[] {
  const out: Filter[] = [];
  const seen = new Set<string>();
  const add = (base: string, at: number) => {
    if (seen.has(base)) return;
    seen.add(base);
    out.push({ dim: "asset", value: base, label: base, at });
  };
  for (const [alias, base] of Object.entries(ASSET_ALIASES)) {
    const at = findPhrase(norm, alias);
    if (at >= 0) add(base, at);
  }
  for (const base of [...new Set([...assets, ...COMMON_ASSETS])]) {
    const b = base.toLowerCase();
    if (b.length < 2) continue;
    for (const form of [b, `${b}usdt`, `${b}usd`, `${b}/usdt`, `${b}-usdt`]) {
      const at = findPhrase(norm, form);
      if (at >= 0) {
        add(base, at);
        break;
      }
    }
  }
  return out;
}

function numericFilters(norm: string): Filter[] {
  const out: Filter[] = [];
  // conviction: "überzeugung 5", "überzeugung ab 4", "hohe überzeugung", "niedrige überzeugung"
  const c1 = / (?:ueberzeugung|conviction) (?:von )?(ab |mindestens |ueber |unter |bis )?([1-5])(?= )/.exec(norm);
  if (c1) {
    const w = (c1[1] ?? "").trim();
    const num = Number(c1[2]);
    const op = w === "ab" || w === "mindestens" ? ">=" : w === "ueber" ? ">" : w === "unter" ? "<" : w === "bis" ? "<=" : "=";
    out.push({ dim: "conviction", value: `${op}${num}`, label: `Überzeugung ${op === "=" ? "" : `${op.replace(">=", "≥").replace("<=", "≤")} `}${num}`, op, num, at: c1.index });
  } else if (/ (?:hohe[rnm]?|hoher) (?:ueberzeugung|conviction)/.test(norm)) out.push({ dim: "conviction", value: ">=4", label: "Überzeugung ≥ 4", op: ">=", num: 4, at: norm.indexOf("ueberzeugung") });
  else if (/ (?:niedrige[rnm]?|geringe[rnm]?|niedriger) (?:ueberzeugung|conviction)/.test(norm)) out.push({ dim: "conviction", value: "<=2", label: "Überzeugung ≤ 2", op: "<=", num: 2, at: norm.indexOf("ueberzeugung") });
  // leverage: "hebel über 10", "mehr als 10x hebel", "hebel 5", "10x"
  const l1 = / hebel (ueber|unter|ab|bis|mehr als|weniger als|>|<|von)? ?(\d{1,3})(?:x)?(?= )/.exec(norm) ?? / (ueber|unter|ab|bis|mehr als|weniger als) (\d{1,3}) ?x? hebel(?= )/.exec(norm);
  if (l1) {
    const w = (l1[1] ?? "").trim();
    const num = Number(l1[2]);
    const op = w === "ueber" || w === "mehr als" || w === ">" ? ">" : w === "unter" || w === "weniger als" || w === "<" ? "<" : w === "ab" ? ">=" : w === "bis" ? "<=" : "=";
    out.push({ dim: "leverage", value: `${op}${num}`, label: `Hebel ${op === "=" ? "" : `${op.replace(">=", "≥").replace("<=", "≤")} `}${num}×`, op, num, at: l1.index });
  }
  // bare "4x" / "1x" (every one – "mit Hebel 4x profitabler als mit 1x" names two)
  const seen = new Set(out.filter((f) => f.dim === "leverage").map((f) => f.num));
  for (const l2 of norm.matchAll(/ (\d{1,3}) ?x(?= )/g)) {
    if (l1 && l2.index! >= l1.index && l2.index! < l1.index + l1[0].length) continue;
    const num = Number(l2[1]);
    if (seen.has(num)) continue;
    seen.add(num);
    out.push({ dim: "leverage", value: `=${num}`, label: `Hebel ${num}×`, op: "=", num, at: l2.index! });
  }
  return out;
}

const TF_FORMS: readonly [string, string][] = [
  ["1m", "1m"],
  ["5m", "5m"],
  ["15m", "15m"],
  ["30m", "30m"],
  ["45m", "45m"],
  ["1h", "1h"],
  ["2h", "2h"],
  ["4h", "4h"],
  ["1d", "1D"],
  ["3d", "3D"],
  ["1w", "1W"],
];

function otherFilters(norm: string, ctx: ParseContext): Filter[] {
  const out: Filter[] = [];
  for (const [form, tf] of TF_FORMS) {
    const at = findPhrase(norm, form);
    if (at >= 0) out.push({ dim: "timeframe", value: tf, label: tf, at });
  }
  for (const m of norm.matchAll(/ #([a-z0-9_-]+)(?= )/g)) {
    const tag = (ctx.tags ?? []).find((t) => normalize(t).trim() === m[1]) ?? m[1]!;
    out.push({ dim: "tag", value: tag, label: `#${tag}`, at: m.index! });
  }
  return out;
}

/* ------------------------------------------------------------------ parse */

function detectMetric(norm: string): { metric: MetricKey; at: number } | null {
  let best: { metric: MetricKey; at: number; len: number } | null = null;
  for (const [k, list] of Object.entries(METRIC_SYNONYMS) as [MetricKey, string[]][]) {
    const hit = firstOf(norm, list);
    if (hit && (!best || hit.phrase.length > best.len)) best = { metric: k, at: hit.at, len: hit.phrase.length };
  }
  // a lone "r" ("Ø R bei BTC", "wie viel R")
  if (!best && / r(?= )/.test(norm)) return { metric: "avgR", at: norm.indexOf(" r ") };
  return best ? { metric: best.metric, at: best.at } : null;
}

function detectBehavior(norm: string): BehaviorKey | null {
  let best: { key: BehaviorKey; len: number } | null = null;
  for (const [k, list] of Object.entries(BEHAVIOR_SYNONYMS) as [BehaviorKey, string[]][]) {
    const hit = firstOf(norm, list);
    if (hit && (!best || hit.phrase.length > best.len)) best = { key: k, len: hit.phrase.length };
  }
  return best?.key ?? null;
}

function detectGroup(norm: string): GroupDim | null {
  let best: { dim: GroupDim; at: number } | null = null;
  for (const [dim, nouns] of Object.entries(DIM_NOUNS) as [GroupDim, string[]][]) {
    for (const noun of nouns) {
      const at = findPhrase(norm, noun);
      if (at < 0) continue;
      // a trigger word right before the noun (at most two words in between: "welche handels session", "bestes eigenes setup")
      const before = norm.slice(Math.max(0, at - 40), at + 1);
      const words = before.trim().split(" ").slice(-3);
      const trig = GROUP_TRIGGERS.some((g) => g.split(" ").every((w) => words.includes(w)));
      if (trig && (!best || at < best.at)) best = { dim, at };
    }
  }
  return best?.dim ?? null;
}

/** Parses a German question about the journal. */
export function parseQuestion(text: string, ctx: ParseContext): Intent {
  const norm = normalize(text);
  const understood: string[] = [];
  const periods = parsePeriods(norm, ctx.now);
  const behavior = detectBehavior(norm);
  const metricHit = detectMetric(norm);
  const named = setupFilters(norm, ctx.setups);
  // a word inside a whole setup name ("Makro-Long Support-Zone") is part of that name, not an account / side filter
  const inName = (f: Filter) => f.dim !== "setup" && named.spans.some(([a, b]) => f.at >= a && f.at < b);
  const filters: Filter[] = [
    ...valueFilters(norm, "side", SIDE_VALUES),
    ...valueFilters(norm, "account", ACCOUNT_VALUES),
    ...valueFilters(norm, "weekday", WEEKDAY_VALUES),
    ...valueFilters(norm, "session", SESSION_VALUES),
    ...valueFilters(norm, "result", RESULT_VALUES),
    ...valueFilters(norm, "emotion", EMOTION_VALUES),
    ...named.filters,
    ...assetFilters(norm, ctx.assets),
    ...numericFilters(norm),
    ...otherFilters(norm, ctx),
  ]
    .filter((f) => !inName(f))
    .sort((a, b) => a.at - b.at);
  // "wochenende" is a session; a weekday filter of the same words would double it
  let groupBy = detectGroup(norm);
  // "profitabler als", "besser als", "lieber als": a comparative between two values of one dimension compares them
  const comparative = / (?:\S+er|besser|lieber) als /.test(norm);
  const wantsCompare = COMPARE_WORDS.some((w) => findPhrase(norm, w) >= 0) || (comparative && filters.length >= 2);
  const sort: Intent["sort"] = SORT_WORST.some((w) => findPhrase(norm, w) >= 0) ? "worst" : SORT_BEST.some((w) => findPhrase(norm, w) >= 0) ? "best" : null;

  // comparison: two values of the same dimension, or two periods
  let compare: [Filter, Filter] | null = null;
  let period: Period | null = periods[0] ?? null;
  let period2: Period | null = null;
  if (wantsCompare || (filters.length >= 2 && / oder /.test(norm))) {
    const dims = new Map<FilterDim, Filter[]>();
    for (const f of filters) dims.set(f.dim, [...(dims.get(f.dim) ?? []), f]);
    for (const [, fs] of dims)
      if (fs.length >= 2 && fs[0]!.value !== fs[1]!.value) {
        compare = [fs[0]!, fs[1]!];
        break;
      }
    if (!compare && periods.length >= 2) {
      period = periods[0]!;
      period2 = periods[1]!;
    } else if (!compare && periods.length === 1 && wantsCompare) {
      const p = periods[0]!;
      const len = p.to - p.from;
      if (Number.isFinite(len)) period2 = { ...p, from: p.from - len, to: p.from, label: "Vorperiode", at: p.at + 1 };
    }
  }
  const usedInCompare = new Set(compare ?? []);
  const plainFilters = filters.filter((f) => !usedInCompare.has(f));
  // a group-by on a dimension that is also filtered makes no sense: the filter wins
  if (groupBy && plainFilters.some((f) => f.dim === groupBy)) groupBy = null;

  const isList = LIST_WORDS.some((w) => findPhrase(norm, w) >= 0);
  const isSummary = SUMMARY_WORDS.some((w) => findPhrase(norm, w) >= 0);

  let type: IntentType;
  if (compare || period2) type = "compare";
  else if (behavior && !groupBy) type = "behavior";
  else if (groupBy) type = "group";
  else if (isList && !metricHit) type = "list";
  else if (metricHit) type = "metric";
  else if (isSummary || period || plainFilters.length) type = "summary";
  else type = "unknown";

  let metric: MetricKey = metricHit?.metric ?? "net";
  // "wie oft gewinne ich" is a win rate; "wie oft Revenge" is a count of events (handled by type behavior)
  if (metricHit?.metric === "count" && /gewinn/.test(norm)) metric = "winRate";

  if (metricHit) understood.push(METRIC_LABEL[metric]);
  if (behavior) understood.push(BEHAVIOR_LABEL[behavior]);
  for (const f of plainFilters) understood.push(f.label);
  if (compare) understood.push(`${compare[0].label} vs. ${compare[1].label}`);
  if (period) understood.push(period.label);
  if (period2) understood.push(`vs. ${period2.label}`);
  if (groupBy) understood.push(`pro ${DIM_LABEL[groupBy]}`);
  if (sort && type === "group") understood.push(sort === "best" ? "beste zuerst" : "schwächste zuerst");

  return { raw: text, norm, type, metric, metricExplicit: !!metricHit, filters: plainFilters, period, period2, groupBy, sort, compare, behavior, understood };
}

export const DIM_LABEL: Readonly<Record<GroupDim, string>> = {
  setup: "Setup",
  session: "Session",
  weekday: "Wochentag",
  hour: "Uhrzeit",
  asset: "Paar",
  month: "Monat",
  leverage: "Hebel",
  timeframe: "Timeframe",
  emotion: "Gefühl",
  side: "Richtung",
  account: "Konto",
  conviction: "Überzeugung",
  regime: "Lage",
  strength: "Signal-Stärke",
  tag: "Tag",
  exchange: "Börse",
  hold: "Haltedauer",
};

/** Asset base of a pair ("BINANCE:BTCUSDT.P" → "BTC"). */
export function assetBase(pairKeyUpper: string): string {
  return pairKeyUpper.replace(QUOTE_SUFFIX, "") || pairKeyUpper;
}
