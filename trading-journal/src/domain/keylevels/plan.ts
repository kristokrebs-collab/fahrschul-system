/**
 * Dynamischer Tages- und Szenarioplan (F08): range / long / short / wait, built from the user's key levels instead of
 * five fixed ones. For every scenario: the trigger, the invalidation and ONE line "what changes the plan". Pure.
 *
 * Which scenario is active:
 * - a level counts as a trigger when its role is `long` / `short` (or `auto`: direction above → long, below → short);
 *   `stop` levels are invalidations, `info` levels are not part of the plan;
 * - a trigger is "fired" only when its status is `confirmed` – `provisional` arms a scenario, it never activates it, and
 *   `unknown` (no data) never counts;
 * - one side fired → that scenario; both sides fired (timeframes disagree) → `precedence` decides: the higher / lower
 *   timeframe wins, or the better `priority`, or the plan waits (`wait`, also on a tie);
 * - nothing fired: both a long and a short trigger exist → range; otherwise → wait. Missing data → wait, never a guess.
 *
 * With only the five fixed levels this is `scenario()`'s four-way classifier on the latest closed 4H candle:
 * `bear` and `short` both → short (the hard invalidation is named in the headline), `long`, `range` the same.
 */
import { n0 } from "@/lib/format";
import { tfLabel } from "./timeframes";
import { KEY_TF_MS, type KeyLevel, type LevelEvaluation, type Precedence } from "./types";

export type PlanKey = "range" | "long" | "short" | "wait";
export type PlanTone = "win" | "loss" | "mute" | "warn";
export type PlanState = "active" | "armed" | "blocked" | "inactive";

export interface LevelEntry {
  level: KeyLevel;
  evaluation: LevelEvaluation;
}

export interface PlanScenario {
  key: PlanKey;
  title: string;
  tone: PlanTone;
  state: PlanState;
  /** German: what has to happen */
  trigger: string;
  /** German: what kills the scenario */
  invalidation: string;
  /** German: one line – what changes the plan */
  changes: string;
  /** levels the scenario rests on */
  levelIds: string[];
}

export type PlanReason = "levels" | "conflict" | "data" | "none";

export interface DayPlan {
  active: PlanKey;
  /** why the plan is what it is: `levels` = a normal outcome, `conflict` = timeframes disagree, `data` = data missing */
  reason: PlanReason;
  headline: string;
  detail: string;
  tone: PlanTone;
  scenarios: PlanScenario[];
  /** the precedence in words, shown whenever it mattered */
  precedenceNote: string | null;
  /** id of the level that decided the active scenario (`null` for range / wait) */
  decidedBy: string | null;
  /** dedupe key: changes only when the active scenario or the reason changes */
  key: string;
}

export const PLAN_TITLE: Readonly<Record<PlanKey, string>> = { range: "Range", long: "Long", short: "Short", wait: "Abwarten" };
const PLAN_TONE: Readonly<Record<PlanKey, PlanTone>> = { range: "mute", long: "win", short: "loss", wait: "warn" };

export const PRECEDENCE_LABEL: Readonly<Record<Precedence, string>> = {
  higher: "Höhere Zeiteinheit gewinnt",
  lower: "Kleinere Zeiteinheit gewinnt",
  priority: "Höhere Priorität gewinnt",
  wait: "Bei Widerspruch abwarten",
};

const roleOf = (l: KeyLevel): "long" | "short" | "stop" | "info" => (l.role === "auto" ? (l.direction === "above" ? "long" : "short") : l.role);
const over = (l: KeyLevel): string => (l.direction === "above" ? "über" : "unter");
const backOf = (l: KeyLevel): string => (l.direction === "above" ? "unter" : "über");

/** "4H-Schluss über 85.900" – the trigger of one level in words. */
export function triggerText(l: KeyLevel, ev?: Pick<LevelEvaluation, "trigger"> | null): string {
  const p = n0(l.price);
  const tf = tfLabel(l.tf);
  switch (l.kind) {
    case "touch":
      return `Kurs berührt ${p}`;
    case "running":
      return `Kurs ${over(l)} ${p} (laufende ${tf}-Kerze, vorläufig)`;
    case "close":
      return `${tf}-Schluss ${over(l)} ${p}`;
    case "closes":
      return `${l.closes} ${tf}-Schlüsse in Folge ${over(l)} ${p}`;
    case "buffer":
      return `${tf}-Schluss ${over(l)} ${n0(ev?.trigger ?? l.price)} (${p} plus Puffer)`;
    default:
      return `${tf}-Schluss ${over(l)} ${p}, danach bestätigter Retest`;
  }
}

/** The price/level that kills the scenario of `trigger`: its own invalidation, else the nearest stop level, else a close back across it. */
export function invalidationText(trigger: KeyLevel, entries: readonly LevelEntry[]): string {
  const tf = tfLabel(trigger.tf);
  if (trigger.invalidation != null) return `${tf}-Schluss ${backOf(trigger)} ${n0(trigger.invalidation)}`;
  const wantBelow = trigger.direction === "above";
  const stops = entries
    .map((e) => e.level)
    .filter((l) => roleOf(l) === "stop" && l.enabled && (wantBelow ? l.price < trigger.price : l.price > trigger.price))
    .sort((a, b) => (wantBelow ? b.price - a.price : a.price - b.price));
  const stop = stops[0];
  if (stop) return `${tfLabel(stop.tf)}-Schluss ${backOf(trigger)} ${n0(stop.price)} (${stop.name})`;
  return `${tf}-Schluss zurück ${backOf(trigger)} ${n0(trigger.price)}`;
}

function winnerOf(fired: readonly LevelEntry[], precedence: Precedence): LevelEntry | null {
  if (!fired.length) return null;
  const rank = (e: LevelEntry): number => (precedence === "higher" ? -KEY_TF_MS[e.level.tf] : precedence === "lower" ? KEY_TF_MS[e.level.tf] : e.level.priority);
  const sorted = [...fired].sort((a, b) => rank(a) - rank(b));
  return sorted[0] ?? null;
}

/** The deciding side when both fired: `null` = wait (rule says so, or a tie). */
export function resolveConflict(longs: readonly LevelEntry[], shorts: readonly LevelEntry[], precedence: Precedence): { side: "long" | "short"; by: LevelEntry } | null {
  if (precedence === "wait") return null;
  const l = winnerOf(longs, precedence);
  const s = winnerOf(shorts, precedence);
  if (!l || !s) return null;
  const rk = (e: LevelEntry): number => (precedence === "higher" ? -KEY_TF_MS[e.level.tf] : precedence === "lower" ? KEY_TF_MS[e.level.tf] : e.level.priority);
  if (rk(l) === rk(s)) return null;
  return rk(l) < rk(s) ? { side: "long", by: l } : { side: "short", by: s };
}

/** Nearest trigger to `ref` (prefers a provisional one, then the closest price). */
function primary(entries: readonly LevelEntry[], ref: number | null): LevelEntry | null {
  if (!entries.length) return null;
  const score = (e: LevelEntry): number => (e.evaluation.status === "provisional" ? -1e12 : 0) + (ref == null ? e.level.priority : Math.abs(e.level.price - ref));
  return [...entries].sort((a, b) => score(a) - score(b))[0] ?? null;
}

export interface PlanInput {
  entries: readonly LevelEntry[];
  precedence: Precedence;
  /** last price (live), else the evaluations' last close is used */
  price?: number | null;
}

/** Builds the plan from the evaluated levels of the live symbol. */
export function buildDayPlan(input: PlanInput): DayPlan {
  const entries = input.entries.filter((e) => e.level.enabled);
  const triggers = entries.filter((e) => roleOf(e.level) === "long" || roleOf(e.level) === "short");
  const longs = triggers.filter((e) => roleOf(e.level) === "long");
  const shorts = triggers.filter((e) => roleOf(e.level) === "short");
  const stopsHit = entries.filter((e) => roleOf(e.level) === "stop" && e.level.direction === "below" && e.evaluation.status === "confirmed");
  const ref = input.price ?? entries.map((e) => e.evaluation.last).find((x): x is number => x != null) ?? null;
  const firedL = longs.filter((e) => e.evaluation.status === "confirmed");
  const firedS = shorts.filter((e) => e.evaluation.status === "confirmed");
  const unknown = triggers.filter((e) => e.evaluation.status === "unknown");

  let active: PlanKey;
  let reason: PlanReason = "levels";
  let decided: LevelEntry | null = null;
  let precedenceNote: string | null = null;
  let blocked: "long" | "short" | null = null;

  if (!triggers.length) {
    active = "wait";
    reason = "none";
  } else if (firedL.length && firedS.length) {
    const res = resolveConflict(firedL, firedS, input.precedence);
    precedenceNote = PRECEDENCE_LABEL[input.precedence];
    if (res) {
      active = res.side;
      decided = res.by;
      blocked = res.side === "long" ? "short" : "long";
    } else {
      active = "wait";
      reason = "conflict";
    }
  } else if (firedL.length) {
    active = "long";
    decided = winnerOf(firedL, input.precedence);
  } else if (firedS.length) {
    active = "short";
    decided = winnerOf(firedS, input.precedence);
  } else if (unknown.length === triggers.length) {
    active = "wait";
    reason = "data";
  } else if (longs.length && shorts.length) {
    active = "range";
  } else {
    active = "wait";
    reason = "none";
  }

  const pl = primary(firedL.length ? firedL : longs, ref);
  const ps = primary(firedS.length ? firedS : shorts, ref);
  const longTrig = pl ? triggerText(pl.level, pl.evaluation) : "Kein Long-Trigger gesetzt";
  const shortTrig = ps ? triggerText(ps.level, ps.evaluation) : "Kein Short-Trigger gesetzt";
  const longInv = pl ? invalidationText(pl.level, entries) : "–";
  const shortInv = ps ? invalidationText(ps.level, entries) : "–";
  const more = (list: readonly LevelEntry[], p: LevelEntry | null): string => (list.length > 1 && p ? ` (+${list.length - 1} weitere)` : "");
  const armed = (list: readonly LevelEntry[]): boolean => list.some((e) => e.evaluation.status === "provisional");

  const lowerBound = ps ? n0(ps.level.price) : null;
  const upperBound = pl ? n0(pl.level.price) : null;
  const rangeTrigger = pl && ps ? `Kein Trigger ausgelöst: ${tfLabel(ps.level.tf)} ${lowerBound} … ${upperBound} ${tfLabel(pl.level.tf)}` : "Braucht einen Long- und einen Short-Trigger";

  const state = (key: PlanKey): PlanState => {
    if (key === active) return "active";
    if ((key === "long" || key === "short") && blocked === key) return "blocked";
    if (key === "long" && armed(longs)) return "armed";
    if (key === "short" && armed(shorts)) return "armed";
    return "inactive";
  };

  const longChanges = active === "long" ? `Long ist vorbei bei: ${longInv}.` : pl ? `Wird aktiv bei: ${longTrig}.` : "Lege einen Long-Trigger fest, um das Szenario zu sehen.";
  const shortChanges = active === "short" ? `Short ist vorbei bei: ${shortInv}.` : ps ? `Wird aktiv bei: ${shortTrig}.` : "Lege einen Short-Trigger fest, um das Szenario zu sehen.";
  const waitDetail =
    reason === "conflict"
      ? "Lange und kurze Trigger sind gleichzeitig bestätigt – laut Vorrang gilt weder noch."
      : reason === "data"
        ? "Für die Trigger-Zeiteinheiten fehlen Kerzen – ohne Daten gibt es kein Szenario."
        : "Es gibt keinen auswertbaren Trigger.";

  const scenarios: PlanScenario[] = [
    {
      key: "range",
      title: PLAN_TITLE.range,
      tone: PLAN_TONE.range,
      state: state("range"),
      trigger: rangeTrigger,
      invalidation: pl || ps ? `Endet mit ${pl ? triggerText(pl.level, pl.evaluation) : "–"} oder ${ps ? triggerText(ps.level, ps.evaluation) : "–"}` : "–",
      changes: pl && ps ? `Ein Schluss ${over(pl.level)} ${upperBound} macht daraus Long, ${over(ps.level)} ${lowerBound} Short.` : "Mit einem Long- und einem Short-Trigger entsteht eine Range.",
      levelIds: [pl, ps].filter((e): e is LevelEntry => !!e).map((e) => e.level.id),
    },
    {
      key: "long",
      title: PLAN_TITLE.long,
      tone: PLAN_TONE.long,
      state: state("long"),
      trigger: `${longTrig}${more(longs, pl)}${armed(longs) && active !== "long" ? " – vorläufig erfüllt" : ""}`,
      invalidation: longInv,
      changes: longChanges,
      levelIds: pl ? [pl.level.id] : [],
    },
    {
      key: "short",
      title: PLAN_TITLE.short,
      tone: PLAN_TONE.short,
      state: state("short"),
      trigger: `${shortTrig}${more(shorts, ps)}${armed(shorts) && active !== "short" ? " – vorläufig erfüllt" : ""}`,
      invalidation: shortInv,
      changes: shortChanges,
      levelIds: ps ? [ps.level.id] : [],
    },
    {
      key: "wait",
      title: PLAN_TITLE.wait,
      tone: PLAN_TONE.wait,
      state: state("wait"),
      trigger: active === "wait" ? waitDetail : "Wenn Daten fehlen oder Trigger sich widersprechen.",
      invalidation: "Sobald ein Trigger eindeutig bestätigt ist.",
      changes: active === "wait" ? (reason === "conflict" ? "Ein klarer Schluss auf einer Seite löst den Widerspruch." : "Sobald Kerzen da sind oder ein Trigger gesetzt ist, entsteht ein Plan.") : "Ein Widerspruch der Trigger oder fehlende Kerzen schalten auf Abwarten.",
      levelIds: [],
    },
  ];

  const hard = active === "short" && stopsHit.length > 0;
  const headline =
    active === "long"
      ? "Long-Szenario aktiv"
      : active === "short"
        ? hard
          ? "Short-Szenario aktiv – harte Invalidierung unterschritten"
          : "Short-Szenario aktiv"
        : active === "range"
          ? "Range – kein Trigger"
          : reason === "conflict"
            ? "Abwarten – die Zeiteinheiten widersprechen sich"
            : reason === "data"
              ? "Abwarten – Daten fehlen"
              : "Abwarten – kein Trigger gesetzt";
  const active_ = scenarios.find((s) => s.key === active)!;
  const detail = active === "wait" ? waitDetail : active === "range" ? rangeTrigger : decided ? `${decided.level.name}: ${decided.evaluation.reason}` : active_.trigger;

  return {
    active,
    reason,
    headline,
    detail,
    tone: PLAN_TONE[active],
    scenarios,
    precedenceNote,
    decidedBy: decided?.level.id ?? null,
    key: `${active}:${reason}:${decided?.level.id ?? ""}`,
  };
}

/** What the last announced plan was (persisted by the watcher). */
export interface PlanMemory {
  key: string;
  active: PlanKey;
  reason: PlanReason;
  at: number;
}

export const PLAN_TOAST_GAP_MS = 30 * 60_000;

export interface PlanChange {
  title: string;
  detail: string;
  tone: PlanTone;
}

/**
 * Whether the move from `prev` to `plan` is worth a toast – and its text. Never on the first plan (`prev` is `null`:
 * the watcher only remembers it), never for a change of the same key, never into or out of a plan that waits only because
 * data is missing (a feed hiccup is not a plan change), and the same transition not twice within `PLAN_TOAST_GAP_MS`.
 */
export function planChange(prev: PlanMemory | null, plan: DayPlan, now: number, lastTransition?: { from: PlanKey; to: PlanKey; at: number } | null): PlanChange | null {
  if (!prev || prev.key === plan.key) return null;
  if (prev.reason === "data" || plan.reason === "data") return null;
  if (prev.active === plan.active && prev.reason === plan.reason) return null; // another level, same scenario
  if (lastTransition && lastTransition.from === prev.active && lastTransition.to === plan.active && now - lastTransition.at < PLAN_TOAST_GAP_MS) return null;
  return { title: `Plan: ${PLAN_TITLE[prev.active]} → ${PLAN_TITLE[plan.active]}`, detail: plan.detail, tone: plan.tone };
}
