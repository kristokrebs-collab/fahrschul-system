/**
 * Bias-Test records (F62 "Chart spiegeln / Bias prüfen") – a passthrough settings key, synced like every setting:
 *
 *   settings.biasTests = { v: 1, tests: BiasTest[] }
 *
 * `tests` is an array of objects with an `id`, so `merge3` (cloud sync, the local adapter) merges two devices per id and
 * an edit beats a delete. Writers return a NEW settings object with every other key – also unknown keys inside
 * `biasTests` and inside each test – untouched; older data is never rewritten. Pure.
 *
 * Order of events (the point of the test): the FIRST answer is written before the chart is mirrored, the SECOND before the
 * original view is uncovered (`revealedAt`), and neither is editable afterwards. The outcome – what the price did after the
 * anchor – is recorded LATER by the trader, in their own words (`up | down | sideways | unclear`); nothing here reads a
 * future price. There is deliberately no "bias score": a single answer cannot carry one.
 */
import type { Settings } from "../types";
import { DEFAULT_MIRROR_LAYERS, MIRROR_LAYER_KEYS, type MirrorLayers } from "@/chart/mirror";

export const BIAS_TESTS_VERSION = 1;
/** Tests kept in the settings row (oldest dropped past this – a trader runs a handful, not thousands). */
export const BIAS_TESTS_MAX = 200;

export type Direction = "long" | "short" | "neutral";
export const DIRECTIONS: readonly Direction[] = ["long", "short", "neutral"];
export const DIRECTION_LABEL: Readonly<Record<Direction, string>> = { long: "Long", short: "Short", neutral: "Neutral" };

export type BiasSurface = "markt" | "replay";

export type OutcomeValue = "up" | "down" | "sideways" | "unclear";
export const OUTCOMES: readonly OutcomeValue[] = ["up", "down", "sideways", "unclear"];
export const OUTCOME_LABEL: Readonly<Record<OutcomeValue, string>> = { up: "Preis stieg", down: "Preis fiel", sideways: "Seitwärts", unclear: "Unklar" };

export interface BiasAnswer {
  direction: Direction;
  /** the conditions of the thesis (first answer) / the trigger (second answer) */
  conditions: string;
  invalidation: string;
  /** ISO time the answer was saved */
  at: string;
}

/** What was covered while the test ran (all off = the plain chart is rated). */
export interface BiasBlind {
  hideName: boolean;
  hidePosition: boolean;
  hidePnl: boolean;
  neutralColors: boolean;
}

export const NO_BLIND: Readonly<BiasBlind> = Object.freeze({ hideName: false, hidePosition: false, hidePnl: false, neutralColors: false });
export const FULL_BLIND: Readonly<BiasBlind> = Object.freeze({ hideName: true, hidePosition: true, hidePnl: true, neutralColors: true });

export interface BiasContext {
  surface: BiasSurface;
  /** the market as the chart carries it (e.g. `BTCUSDT`); kept, but not shown while the name is covered */
  symbol: string;
  /** chart interval (`4h`, `15m` …) */
  interval: string;
  /** open time (ms) of the LAST bar the trader saw – nothing after it was visible */
  anchorMs: number;
  /** replay: the trade whose replay was frozen */
  tradeId?: string;
}

export interface BiasOutcome {
  value: OutcomeValue;
  note: string;
  /** ISO time the trader recorded it */
  at: string;
}

export interface BiasTest {
  id: string;
  v: number;
  /** ISO time the first answer was saved = the start of the test */
  createdAt: string;
  updatedAt: string;
  context: BiasContext;
  blind: BiasBlind;
  /** which signals / overlays were shown */
  layers: MirrorLayers;
  /** the RSI pane was read as 100−RSI during the mirrored step */
  rsiMirrored: boolean;
  first: BiasAnswer;
  second?: BiasAnswer;
  /** ISO time the original view was uncovered (set together with / after the second answer) */
  revealedAt?: string;
  outcome?: BiasOutcome;
}

/** The test is finished: both answers saved and the original view uncovered. */
export const isRevealed = (t: Pick<BiasTest, "second" | "revealedAt">): boolean => t.second != null && t.revealedAt != null;
/** A test that was started but never finished (second answer or reveal missing). */
export const isOpen = (t: Pick<BiasTest, "second" | "revealedAt">): boolean => !isRevealed(t);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const iso = (v: unknown): string | null => (typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v)) ? v : null);
const direction = (v: unknown): Direction | null => (v === "long" || v === "short" || v === "neutral" ? v : null);

export const TEXT_MAX = 1000;

function answerOf(raw: unknown): BiasAnswer | null {
  if (!isObj(raw)) return null;
  const d = direction(raw.direction);
  const at = iso(raw.at);
  if (!d || !at) return null;
  return { ...(raw as object), direction: d, conditions: str(raw.conditions, TEXT_MAX), invalidation: str(raw.invalidation, TEXT_MAX), at };
}

function layersOf(raw: unknown): MirrorLayers {
  const o = isObj(raw) ? raw : {};
  const out = { ...DEFAULT_MIRROR_LAYERS };
  for (const k of MIRROR_LAYER_KEYS) if (typeof o[k] === "boolean") out[k] = o[k];
  return out;
}

function blindOf(raw: unknown): BiasBlind {
  const o = isObj(raw) ? raw : {};
  return { hideName: o.hideName === true, hidePosition: o.hidePosition === true, hidePnl: o.hidePnl === true, neutralColors: o.neutralColors === true };
}

function outcomeOf(raw: unknown): BiasOutcome | null {
  if (!isObj(raw)) return null;
  const value = OUTCOMES.find((o) => o === raw.value);
  const at = iso(raw.at);
  return value && at ? { ...(raw as object), value, note: str(raw.note, TEXT_MAX), at } : null;
}

/** One stored test, sanitised; `null` when it cannot be read (no id, no first answer, no anchor). Unknown keys kept. */
export function biasTestOf(raw: unknown): BiasTest | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const first = answerOf(raw.first);
  const c = isObj(raw.context) ? raw.context : null;
  const createdAt = iso(raw.createdAt) ?? first?.at ?? null;
  if (!first || !c || !createdAt) return null;
  const anchorMs = typeof c.anchorMs === "number" && Number.isFinite(c.anchorMs) ? c.anchorMs : null;
  if (anchorMs == null) return null;
  const context: BiasContext = { ...(c as object), surface: c.surface === "replay" ? "replay" : "markt", symbol: str(c.symbol, 40), interval: str(c.interval, 8), anchorMs };
  if (typeof c.tradeId === "string" && c.tradeId) context.tradeId = c.tradeId;
  else delete context.tradeId;
  const t: BiasTest = { ...(raw as object), id: raw.id, v: typeof raw.v === "number" ? raw.v : BIAS_TESTS_VERSION, createdAt, updatedAt: iso(raw.updatedAt) ?? createdAt, context, blind: blindOf(raw.blind), layers: layersOf(raw.layers), rsiMirrored: raw.rsiMirrored === true, first };
  const second = answerOf(raw.second);
  if (second) t.second = second;
  else delete t.second;
  const revealedAt = iso(raw.revealedAt);
  if (revealedAt && second) t.revealedAt = revealedAt;
  else delete t.revealedAt;
  const outcome = outcomeOf(raw.outcome);
  if (outcome && t.revealedAt) t.outcome = outcome;
  else delete t.outcome;
  return t;
}

/** The tests in `settings.biasTests`, oldest first (a broken key or entry reads as nothing). */
export function biasTestsOf(settings: object): BiasTest[] {
  const b = (settings as { biasTests?: unknown }).biasTests;
  const list = isObj(b) && Array.isArray(b.tests) ? b.tests : [];
  const out: BiasTest[] = [];
  for (const x of list) {
    const t = biasTestOf(x);
    if (t) out.push(t);
  }
  return out.sort((a, b2) => a.createdAt.localeCompare(b2.createdAt));
}

function withTests(settings: Settings, edit: (list: Record<string, unknown>[]) => Record<string, unknown>[]): Settings {
  const s = settings as Settings & { biasTests?: unknown };
  const cur = isObj(s.biasTests) ? s.biasTests : {};
  const list = Array.isArray(cur.tests) ? (cur.tests as unknown[]).filter(isObj) : [];
  return { ...s, biasTests: { ...cur, v: BIAS_TESTS_VERSION, tests: edit(list) } } as Settings;
}

/** Inserts a test (or replaces the one with the same id, merging so unknown keys survive). Past `BIAS_TESTS_MAX` the oldest finished ones go. */
export function withBiasTest(settings: Settings, test: BiasTest): Settings {
  return withTests(settings, (list) => {
    const i = list.findIndex((x) => x.id === test.id);
    const next = i < 0 ? [...list, { ...test }] : list.map((x, k) => (k === i ? { ...x, ...test } : x));
    if (next.length <= BIAS_TESTS_MAX) return next;
    const drop = next.length - BIAS_TESTS_MAX;
    const sorted = [...next].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const gone = new Set(sorted.filter((x) => x.revealedAt != null).slice(0, drop).map((x) => x.id));
    return next.filter((x) => !gone.has(x.id as string));
  });
}

/** Merges `patch` into the stored test `id`; the same object when it is missing. */
export function withBiasPatch(settings: Settings, id: string, patch: Record<string, unknown>): Settings {
  const b = (settings as { biasTests?: unknown }).biasTests;
  const has = isObj(b) && Array.isArray(b.tests) && b.tests.some((x) => isObj(x) && x.id === id);
  if (!has) return settings;
  return withTests(settings, (list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
}

/** Removes an unfinished test (finished ones are a record and stay). */
export function withoutOpenBiasTest(settings: Settings, id: string): Settings {
  const b = (settings as { biasTests?: unknown }).biasTests;
  const found = isObj(b) && Array.isArray(b.tests) ? (b.tests as unknown[]).find((x) => isObj(x) && x.id === id) : undefined;
  const t = biasTestOf(found);
  if (!t || isRevealed(t)) return settings;
  return withTests(settings, (list) => list.filter((x) => x.id !== id));
}

/* ------------------------------------------------------------------ answers */

export interface AnswerDraft {
  direction: Direction | null;
  conditions: string;
  invalidation: string;
}

export const EMPTY_DRAFT: Readonly<AnswerDraft> = Object.freeze({ direction: null, conditions: "", invalidation: "" });

/** Why a draft cannot be saved yet (German, one line per gap); empty = complete. Neutral needs no invalidation. */
export function draftGaps(d: AnswerDraft): string[] {
  const gaps: string[] = [];
  if (!d.direction) gaps.push("Richtung wählen (Long, Short oder Neutral).");
  if (!d.conditions.trim()) gaps.push("Bedingungen der These notieren.");
  if (d.direction && d.direction !== "neutral" && !d.invalidation.trim()) gaps.push("Invalidation notieren: ab wo ist die These falsch?");
  return gaps;
}

export function answerOfDraft(d: AnswerDraft, now: number): BiasAnswer | null {
  if (draftGaps(d).length || !d.direction) return null;
  return { direction: d.direction, conditions: d.conditions.trim().slice(0, TEXT_MAX), invalidation: d.invalidation.trim().slice(0, TEXT_MAX), at: new Date(now).toISOString() };
}

export interface NewTestInput {
  id: string;
  context: BiasContext;
  blind: BiasBlind;
  layers: MirrorLayers;
  rsiMirrored: boolean;
  first: BiasAnswer;
}

/** The record written when the first answer is saved – BEFORE the chart is mirrored. */
export function newBiasTest(input: NewTestInput): BiasTest {
  return { id: input.id, v: BIAS_TESTS_VERSION, createdAt: input.first.at, updatedAt: input.first.at, context: input.context, blind: input.blind, layers: input.layers, rsiMirrored: input.rsiMirrored, first: input.first };
}

/** Adds the second answer and uncovers the view in ONE write; refused (`null`) when the test already has a second answer. */
export function withSecondAnswer(t: BiasTest, second: BiasAnswer): BiasTest | null {
  if (t.second) return null;
  return { ...t, second, revealedAt: second.at, updatedAt: second.at };
}

/** The trader's own note on what happened after the anchor; refused for an unfinished test. */
export function withOutcome(t: BiasTest, value: OutcomeValue, note: string, now: number): BiasTest | null {
  if (!isRevealed(t)) return null;
  const at = new Date(now).toISOString();
  return { ...t, outcome: { value, note: note.trim().slice(0, TEXT_MAX), at }, updatedAt: at };
}
