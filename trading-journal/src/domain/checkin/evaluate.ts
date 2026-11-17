/**
 * Check-in against the day's trades (F61) – a correlation with its sample size, never a diagnosis and never a cause.
 *
 * What counts: a day enters the sample only when
 *  - it has ANSWERS (a skipped day, or an empty "Erledigt", is not read as a good or a bad state – it is simply missing),
 *  - the check-in was not filled in on a later day (`late`, "nachgetragen"), and
 *  - it has trades that started AFTER the answers were last changed (`editedAt` ?? `firstAt` ?? `at`). Trades before that
 *    instant cannot have followed this state, and an answer edited after a trade is not "known at entry".
 * Nothing is ever interpolated or filled in, and no trade is judged by what came after it.
 *
 * Per day, from the trades that followed: how many, how many followed the plan, the risk taken, the result in R and the
 * quick re-entries (a trade started within `REENTRY_MIN` minutes after the previous one ended – only where the exit time is
 * known). Each check-in value is then rank-correlated (Spearman) with each of these over the days; under `MIN_CHECKIN_N`
 * days a pair says "zu wenig Daten". Pure; the zone decides which calendar day a trade belongs to.
 */
import { tradeTime } from "@/lib/dates";
import type { DayNotes, EnrichedTrade } from "../types";
import { checkinOf, checkinRawOf, moodOf, type CheckIn } from "../psych/checkin";
import { spearman } from "../psych/mood";
import { dayKeyIn } from "./day";

export const MIN_CHECKIN_N = 8;
export const REENTRY_MIN = 15;

export type OutcomeKey = "count" | "adherence" | "risk" | "result" | "reentries";
export const OUTCOMES: readonly { key: OutcomeKey; label: string }[] = [
  { key: "count", label: "Trades" },
  { key: "adherence", label: "Regelbefolgung" },
  { key: "risk", label: "Risiko" },
  { key: "result", label: "Ergebnis (R)" },
  { key: "reentries", label: "Schnelle Wiedereinstiege" },
];

/** A check-in value: a built-in field or the trader's own question (`custom:<id>`). */
export type PredictorKey = "mood" | "stress" | "energy" | "focus" | "sleep" | "sleepQuality" | "dayRisk" | `custom:${string}`;
export const BUILTIN_PREDICTORS: readonly { key: PredictorKey; label: string }[] = [
  { key: "mood", label: "Stimmung" },
  { key: "stress", label: "Stress" },
  { key: "energy", label: "Energie" },
  { key: "focus", label: "Konzentration" },
  { key: "sleep", label: "Schlaf (h)" },
  { key: "sleepQuality", label: "Schlafqualität" },
  { key: "dayRisk", label: "Geplantes Tagesrisiko" },
];

export interface JoinedDay {
  day: string;
  values: Partial<Record<PredictorKey, number>>;
  /** trades that followed the check-in */
  count: number;
  /** share that followed the plan among those that say so; `null` when none says */
  adherence: number | null;
  risk: number | null;
  /** Σ R of the closed trades with an R; `null` when none */
  result: number | null;
  reentries: number;
}

export interface JoinStats {
  /** days with answers that entered the sample */
  used: number;
  /** answered, but no trade that day */
  noTrades: number;
  /** answered, but every trade started before the (last change of the) answers */
  tradesFirst: number;
  /** filled in on a later day ("nachgetragen") – never counted as known at entry */
  late: number;
  /** answers without any timestamp (very old entries): what was known when cannot be told */
  untimed: number;
  /** "Heute überspringen" */
  skipped: number;
  /** days with trades but no answered check-in – a missing check-in is not read as a good state */
  withoutCheckin: number;
  /** trades in the sample */
  trades: number;
}

export interface Joined {
  rows: JoinedDay[];
  stats: JoinStats;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The value of one predictor on a check-in (`null` = not answered). */
function valueOf(key: PredictorKey, c: CheckIn, mood: number | null): number | null {
  switch (key) {
    case "mood":
      return mood;
    case "stress":
      return c.stress;
    case "energy":
      return c.energy;
    case "focus":
      return c.focus ?? null;
    case "sleep":
      return c.sleep;
    case "sleepQuality":
      return c.sleepQuality ?? null;
    case "dayRisk":
      return c.dayRisk ?? null;
    default:
      return c.custom?.[key.slice(7)] ?? null;
  }
}

const entryMs = (t: EnrichedTrade): number => tradeTime(t).getTime();
const exitMs = (t: EnrichedTrade): number | null => {
  if (!t.exitDate) return null;
  const ms = new Date(t.exitDate).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** Quick re-entries among `followed` (their predecessor is looked up in the whole day). */
function reentriesOf(all: readonly EnrichedTrade[], followed: ReadonlySet<string>): number {
  const sorted = [...all].sort((a, b) => entryMs(a) - entryMs(b));
  let n = 0;
  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i]!;
    if (!followed.has(t.id)) continue;
    const end = exitMs(sorted[i - 1]!);
    if (end == null) continue;
    const gap = entryMs(t) - end;
    if (gap >= 0 && gap <= REENTRY_MIN * 60_000) n++;
  }
  return n;
}

/**
 * Joins the check-ins with the trades that followed them. `tz` is the configured zone; `customIds` the questions to read
 * (answers of a removed question stay in the journal but are not evaluated).
 */
export function joinCheckins({ days, trades, tz, customIds = [] }: { days: DayNotes; trades: readonly EnrichedTrade[]; tz: string; customIds?: readonly string[] }): Joined {
  const byDay = new Map<string, EnrichedTrade[]>();
  for (const t of trades) {
    const ms = entryMs(t);
    if (!Number.isFinite(ms)) continue;
    const k = dayKeyIn(ms, tz);
    const arr = byDay.get(k);
    if (arr) arr.push(t);
    else byDay.set(k, [t]);
  }
  const stats: JoinStats = { used: 0, noTrades: 0, tradesFirst: 0, late: 0, untimed: 0, skipped: 0, withoutCheckin: 0, trades: 0 };
  const rows: JoinedDay[] = [];
  const keys = new Set<string>([...Object.keys(days), ...byDay.keys()]);
  const predictors: PredictorKey[] = [...BUILTIN_PREDICTORS.map((p) => p.key), ...customIds.map((id): PredictorKey => `custom:${id}`)];
  for (const day of [...keys].sort()) {
    const note = days[day];
    const dayTrades = byDay.get(day) ?? [];
    const raw = checkinRawOf(note);
    const answers = checkinOf(note);
    if (!answers) {
      if (raw?.status === "skipped") stats.skipped++;
      else if (dayTrades.length) stats.withoutCheckin++;
      continue;
    }
    if (answers.late) {
      stats.late++;
      continue;
    }
    const knownIso = answers.editedAt ?? answers.firstAt ?? answers.at;
    const knownAt = knownIso ? Date.parse(knownIso) : NaN;
    if (!Number.isFinite(knownAt)) {
      stats.untimed++;
      continue;
    }
    if (!dayTrades.length) {
      stats.noTrades++;
      continue;
    }
    const followed = dayTrades.filter((t) => entryMs(t) >= knownAt);
    if (!followed.length) {
      stats.tradesFirst++;
      continue;
    }
    const mood = moodOf(note);
    const values: Partial<Record<PredictorKey, number>> = {};
    for (const p of predictors) {
      const v = valueOf(p, answers, mood);
      if (v != null) values[p] = v;
    }
    const plan = followed.filter((t) => typeof t.followedPlan === "boolean");
    const risks = followed.map((t) => t.risk).filter(fin);
    const rs = followed.filter((t) => t.status !== "open").map((t) => t.r).filter(fin);
    rows.push({
      day,
      values,
      count: followed.length,
      adherence: plan.length ? plan.filter((t) => t.followedPlan === true).length / plan.length : null,
      risk: risks.length ? risks.reduce((a, b) => a + b, 0) : null,
      result: rs.length ? rs.reduce((a, b) => a + b, 0) : null,
      reentries: reentriesOf(dayTrades, new Set(followed.map((t) => t.id))),
    });
    stats.used++;
    stats.trades += followed.length;
  }
  return { rows, stats };
}

export interface Cell {
  predictor: PredictorKey;
  outcome: OutcomeKey;
  /** days with both values */
  n: number;
  /** Spearman ρ; `null` under `MIN_CHECKIN_N` days or without variance */
  rho: number | null;
}

const outcomeOf = (r: JoinedDay, k: OutcomeKey): number | null => (k === "count" ? r.count : k === "adherence" ? r.adherence : k === "risk" ? r.risk : k === "result" ? r.result : r.reentries);

/** Every predictor × outcome pair over the joined days. */
export function correlationMatrix(rows: readonly JoinedDay[], predictors: readonly PredictorKey[]): Cell[] {
  const out: Cell[] = [];
  for (const p of predictors) {
    for (const o of OUTCOMES) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const r of rows) {
        const x = r.values[p];
        const y = outcomeOf(r, o.key);
        if (x != null && y != null) {
          xs.push(x);
          ys.push(y);
        }
      }
      out.push({ predictor: p, outcome: o.key, n: xs.length, rho: xs.length >= MIN_CHECKIN_N ? spearman(xs, ys) : null });
    }
  }
  return out;
}

export const strengthWord = (rho: number): string => (Math.abs(rho) >= 0.5 ? "deutlich" : Math.abs(rho) >= 0.3 ? "eine Tendenz" : "schwach");

const rhoText = (rho: number): string => rho.toFixed(2).replace(".", ",").replace("-", "−");

/**
 * At most `max` plain sentences about the clearest pairs (|ρ| ≥ 0.3, enough days), each with ρ and the number of days.
 * "Hängen zusammen" says nothing about which one moves the other.
 */
export function notableLines(cells: readonly Cell[], label: (p: PredictorKey) => string, max = 3): string[] {
  const outcome = new Map(OUTCOMES.map((o) => [o.key, o.label]));
  return cells
    .filter((c) => c.rho != null && Math.abs(c.rho) >= 0.3)
    .sort((a, b) => Math.abs(b.rho!) - Math.abs(a.rho!))
    .slice(0, max)
    .map((c) => `${label(c.predictor)} und ${outcome.get(c.outcome)} ${c.rho! > 0 ? "steigen und fallen zusammen" : "laufen gegeneinander"} – ${strengthWord(c.rho!)} (ρ ${rhoText(c.rho!)}, ${c.n} Tage).`);
}
