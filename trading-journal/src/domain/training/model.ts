/**
 * Training records (F38 "Lernmodus / Replay-Training") – a passthrough settings key, synced like every setting:
 *
 *   settings.training = { v: 1, rounds: TrainingRound[] }
 *
 * `rounds` is an array of objects with an `id`, so `merge3` (cloud sync, the local adapter) merges two devices per id. Writers
 * return a NEW settings object with every other key – also unknown keys inside `training` and inside each round – untouched;
 * the reader (`trainingRoundsOf`) drops what it cannot read and never rewrites it. A journal without the key reads as "no
 * rounds". Pure.
 *
 * What a round records (and what it deliberately does not): the DECISION on a chart that ends at the decision candle
 * (recognition, long / short / wait, stop, the setup's checklist, the reason) is written BEFORE the future is shown. What is
 * rewarded is recognition, rule-keeping and reflection – never the profit of a trade, no leverage, no points from P&L. There
 * is no score: the three marks are facts (`recognized`, `rules.followed`, `reflection`), summed up with their sample size.
 */
import type { Settings } from "../types";

export const TRAINING_VERSION = 1;
/** Rounds kept in the settings row (oldest dropped past this). */
export const TRAINING_MAX = 400;
export const TEXT_MAX = 1000;

export type Action = "long" | "short" | "wait";
export const ACTIONS: readonly Action[] = ["long", "short", "wait"];
export const ACTION_LABEL: Readonly<Record<Action, string>> = { long: "Long", short: "Short", wait: "Warten" };

/** "Liegt hier mein Setup vor?" */
export type Recognition = "yes" | "no" | "unsure";
export const RECOGNITIONS: readonly Recognition[] = ["yes", "no", "unsure"];
export const RECOGNITION_LABEL: Readonly<Record<Recognition, string>> = { yes: "Ja", no: "Nein", unsure: "Unsicher" };

export type Verdict = "as_expected" | "surprised" | "unclear";
export const VERDICTS: readonly Verdict[] = ["as_expected", "surprised", "unclear"];
export const VERDICT_LABEL: Readonly<Record<Verdict, string>> = { as_expected: "Wie erwartet", surprised: "Anders als gedacht", unclear: "Schwer zu sagen" };

export interface TrainingDecision {
  action: Action;
  recognition: Recognition;
  /** the stop of an entry (Long / Short), `null` for waiting */
  stop: number | null;
  reason: string;
  /** the checklist item ids ticked as fulfilled at the decision candle */
  checks: Record<string, boolean>;
  /** ISO time the decision was saved = BEFORE the future was shown */
  at: string;
}

export interface RuleResult {
  /** items ticked / items in the checklist */
  checked: number;
  total: number;
  /** stop set on the right side and not absurdly tight; `null` when waiting */
  stopOk: boolean | null;
  /** an entry with every rule ticked and a sane stop (true), an entry with a gap (false); waiting / no rules: `null` */
  followed: boolean | null;
}

export interface Reflection {
  verdict: Verdict;
  note: string;
  at: string;
}

export interface TrainingRound {
  id: string;
  v: number;
  createdAt: string;
  updatedAt: string;
  /** the practised setup */
  setupId: string;
  /** the journal trade the situation comes from (a reference; the trade is never changed) */
  tradeId: string;
  /** the case carried the practised setup in the journal (the truth `recognized` is measured against) */
  positive: boolean;
  /** candle interval and open time (ms) of the LAST candle the trader saw */
  interval: string;
  anchorMs: number;
  /** market name and date were covered while deciding */
  blind: boolean;
  decision: TrainingDecision;
  rules: RuleResult;
  /** the recognition matched the journal's setup tag; `null` = "unsicher" */
  recognized: boolean | null;
  /** ISO time the future was shown */
  revealedAt?: string;
  reflection?: Reflection;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const iso = (v: unknown): string | null => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function decisionOf(raw: unknown): TrainingDecision | null {
  if (!isObj(raw)) return null;
  const action = ACTIONS.find((a) => a === raw.action);
  const recognition = RECOGNITIONS.find((a) => a === raw.recognition);
  const at = iso(raw.at);
  if (!action || !recognition || !at) return null;
  const checks: Record<string, boolean> = {};
  if (isObj(raw.checks)) for (const [k, v] of Object.entries(raw.checks).slice(0, 80)) if (v === true) checks[k.slice(0, 80)] = true;
  return { ...(raw as object), action, recognition, stop: action !== "wait" && fin(raw.stop) && raw.stop > 0 ? raw.stop : null, reason: str(raw.reason, TEXT_MAX), checks, at };
}

function rulesOf(raw: unknown): RuleResult {
  const o = isObj(raw) ? raw : {};
  const count = (v: unknown) => (fin(v) && v >= 0 ? Math.floor(v) : 0);
  return { ...(o as object), checked: count(o.checked), total: count(o.total), stopOk: typeof o.stopOk === "boolean" ? o.stopOk : null, followed: typeof o.followed === "boolean" ? o.followed : null };
}

function reflectionOf(raw: unknown): Reflection | null {
  if (!isObj(raw)) return null;
  const verdict = VERDICTS.find((v) => v === raw.verdict);
  const at = iso(raw.at);
  return verdict && at ? { ...(raw as object), verdict, note: str(raw.note, TEXT_MAX), at } : null;
}

/** One stored round, sanitised; `null` when it cannot be read (no id / setup / trade / decision / anchor). Unknown keys kept. */
export function trainingRoundOf(raw: unknown): TrainingRound | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const decision = decisionOf(raw.decision);
  const createdAt = iso(raw.createdAt) ?? decision?.at ?? null;
  if (!decision || !createdAt || typeof raw.setupId !== "string" || !raw.setupId || typeof raw.tradeId !== "string" || !raw.tradeId || !fin(raw.anchorMs)) return null;
  const positive = raw.positive === true;
  const recognized = decision.recognition === "unsure" ? null : decision.recognition === "yes" ? positive : !positive;
  const r: TrainingRound = {
    ...(raw as object),
    id: raw.id,
    v: fin(raw.v) ? raw.v : TRAINING_VERSION,
    createdAt,
    updatedAt: iso(raw.updatedAt) ?? createdAt,
    setupId: raw.setupId,
    tradeId: raw.tradeId,
    positive,
    interval: str(raw.interval, 8),
    anchorMs: raw.anchorMs,
    blind: raw.blind === true,
    decision,
    rules: rulesOf(raw.rules),
    recognized,
  };
  const revealedAt = iso(raw.revealedAt);
  if (revealedAt) r.revealedAt = revealedAt;
  else delete r.revealedAt;
  const reflection = reflectionOf(raw.reflection);
  if (reflection && revealedAt) r.reflection = reflection;
  else delete r.reflection;
  return r;
}

/** The rounds in `settings.training`, oldest first (a broken key or entry reads as nothing). */
export function trainingRoundsOf(settings: object): TrainingRound[] {
  const t = (settings as { training?: unknown }).training;
  const list = isObj(t) && Array.isArray(t.rounds) ? t.rounds : [];
  const out: TrainingRound[] = [];
  for (const x of list) {
    const r = trainingRoundOf(x);
    if (r) out.push(r);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function withRounds(settings: Settings, edit: (list: Record<string, unknown>[]) => Record<string, unknown>[]): Settings {
  const s = settings as Settings & { training?: unknown };
  const cur = isObj(s.training) ? s.training : {};
  const list = Array.isArray(cur.rounds) ? (cur.rounds as unknown[]).filter(isObj) : [];
  return { ...s, training: { ...cur, v: TRAINING_VERSION, rounds: edit(list) } } as Settings;
}

/** Inserts a round (or replaces the one with the same id, merging so unknown keys survive); past `TRAINING_MAX` the oldest go. */
export function withTrainingRound(settings: Settings, round: TrainingRound): Settings {
  return withRounds(settings, (list) => {
    const i = list.findIndex((x) => x.id === round.id);
    const next = i < 0 ? [...list, { ...round }] : list.map((x, k) => (k === i ? { ...x, ...round } : x));
    if (next.length <= TRAINING_MAX) return next;
    const sorted = [...next].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const gone = new Set(sorted.slice(0, next.length - TRAINING_MAX).map((x) => x.id as string));
    return next.filter((x) => !gone.has(x.id as string));
  });
}

/** Merges `patch` into the stored round `id`; the same object when it is missing. */
export function withRoundPatch(settings: Settings, id: string, patch: Record<string, unknown>): Settings {
  const t = (settings as { training?: unknown }).training;
  const has = isObj(t) && Array.isArray(t.rounds) && t.rounds.some((x) => isObj(x) && x.id === id);
  if (!has) return settings;
  return withRounds(settings, (list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
}

/** The future was shown: stamps `revealedAt` once (a second call keeps the first time). */
export function withReveal(settings: Settings, id: string, now: number): Settings {
  const r = trainingRoundsOf(settings).find((x) => x.id === id);
  if (!r || r.revealedAt) return settings;
  const at = new Date(now).toISOString();
  return withRoundPatch(settings, id, { revealedAt: at, updatedAt: at });
}

/** The trader's own words after the reveal; refused (same object) before the reveal. */
export function withReflection(settings: Settings, id: string, verdict: Verdict, note: string, now: number): Settings {
  const r = trainingRoundsOf(settings).find((x) => x.id === id);
  if (!r || !r.revealedAt) return settings;
  const at = new Date(now).toISOString();
  return withRoundPatch(settings, id, { reflection: { verdict, note: note.trim().slice(0, TEXT_MAX), at }, updatedAt: at });
}

/** Removes a round (e.g. one the trader wants out of the statistics). */
export function withoutRound(settings: Settings, id: string): Settings {
  const t = (settings as { training?: unknown }).training;
  const has = isObj(t) && Array.isArray(t.rounds) && t.rounds.some((x) => isObj(x) && x.id === id);
  return has ? withRounds(settings, (list) => list.filter((x) => x.id !== id)) : settings;
}
