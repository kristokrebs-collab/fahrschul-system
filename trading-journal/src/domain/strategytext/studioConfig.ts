/**
 * `settings.studio` – the versioned passthrough key of the Strategie-Studio: `{ v: 1, strategies: [{ id, name, text, answers,
 * symbol, period, versions: [{ id, n, at, note, text, answers, setup, key, config, stats? }], live: [...] }] }`.
 *
 * Several strategies side by side, each with its own immutable versions. Like `settings.forward` / `settings.keyLevels` it
 * survives `normalizeSettings`, the backup and the cloud / two-tab `merge3`: strategies and versions are arrays of objects
 * with a string `id`, so two devices merge per strategy and per version. Reading is strict per strategy – an entry this
 * version cannot read goes to `rejected` and is written back untouched, never repaired silently; unknown keys of the root
 * and of a strategy survive. A version is a snapshot of text, answers and the rules as they were understood then (the
 * parser may get better; an old version never changes its meaning). Pure.
 */
import { diffConfigs } from "../lab/versions";
import { customKey, parseCustom } from "../lab/rules/tree";
import type { CustomConfig } from "../lab/rules/types";
import { STUDIO_PERIODS, TEXT_MAX, type Answers, type StrategySetup, type StudioPeriod } from "./types";

export const STUDIO_VERSION = 1 as const;
export const MAX_STRATEGIES = 30;
export const MAX_VERSIONS = 30;
export const MAX_NAME = 60;
export const MAX_NOTE = 140;
export const MAX_LIVE = 8;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The key figures of a backtest of a version (numbers the lab computed; absent until a run was saved with it). */
export interface StoredStats {
  n: number;
  winRate: number | null;
  avgR: number | null;
  pf: number | null;
  maxDD: number;
  netPct: number;
  symbol: string;
  interval: string;
  period: StudioPeriod;
  /** ms, when it was computed */
  at: number;
}

export interface StudioVersion {
  /** unique (`v2-k3f9`): two devices that both save a "version 2" offline keep both after the cloud merge */
  id: string;
  /** the number shown (1, 2, 3 …); a clash after a merge is renumbered when the strategy is read */
  n: number;
  /** ms */
  at: number;
  note: string;
  text: string;
  answers: Record<string, string>;
  setup: StrategySetup;
  /** `customKey` of the rules */
  key: string;
  config: CustomConfig;
  stats?: StoredStats;
}

/** A forward account started from the studio (the account itself lives in `settings.forward`). */
export interface LiveLink {
  accountId: string;
  versionNo: number | null;
  /** ms */
  at: number;
}

export interface StoredStrategy {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** the working text (saved as a draft while typing) */
  text: string;
  answers: Record<string, string>;
  /** the market and period this strategy is tested on */
  symbol: string;
  period: StudioPeriod;
  versions: StudioVersion[];
  live: LiveLink[];
  /** keys of the stored entry this version does not know – written back untouched */
  extra: Raw;
}

export interface StudioCfg {
  v: typeof STUDIO_VERSION;
  strategies: StoredStrategy[];
  /** stored entries this version cannot read – written back untouched */
  rejected: unknown[];
}

export const EMPTY_STUDIO: StudioCfg = Object.freeze({ v: STUDIO_VERSION, strategies: [], rejected: [] }) as StudioCfg;
export const DEFAULT_SYMBOL = "BTCUSDT";
export const DEFAULT_PERIOD: StudioPeriod = "1y";

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

function answersOf(raw: unknown): Record<string, string> {
  if (!isObj(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw).slice(0, 60)) if (typeof v === "string" && k.length <= 40 && v.length <= 40 && k !== "__proto__") out[k] = v;
  return out;
}

function setupOf(raw: unknown): StrategySetup {
  const r = isObj(raw) ? raw : {};
  return {
    symbol: typeof r.symbol === "string" && /^[A-Z0-9]{2,24}$/.test(r.symbol) ? r.symbol : null,
    period: (STUDIO_PERIODS as readonly unknown[]).includes(r.period) ? (r.period as StudioPeriod) : null,
    riskPct: fin(r.riskPct) && r.riskPct >= 0.05 && r.riskPct <= 10 ? r.riskPct : null,
  };
}

function statsOf(raw: unknown): StoredStats | undefined {
  if (!isObj(raw)) return undefined;
  if (!fin(raw.n) || raw.n < 0 || !fin(raw.maxDD) || !fin(raw.netPct) || !fin(raw.at)) return undefined;
  if (typeof raw.symbol !== "string" || typeof raw.interval !== "string" || !(STUDIO_PERIODS as readonly unknown[]).includes(raw.period)) return undefined;
  const nul = (v: unknown): number | null => (fin(v) ? v : null);
  return { n: Math.round(raw.n), winRate: nul(raw.winRate), avgR: nul(raw.avgR), pf: nul(raw.pf), maxDD: raw.maxDD, netPct: raw.netPct, symbol: raw.symbol.slice(0, 24), interval: raw.interval.slice(0, 4), period: raw.period as StudioPeriod, at: raw.at };
}

function versionOf(raw: unknown): StudioVersion | null {
  if (!isObj(raw) || !fin(raw.n) || !Number.isInteger(raw.n) || raw.n < 1 || raw.n > 9999) return null;
  if (typeof raw.text !== "string") return null;
  const { config } = parseCustom(raw.config);
  if (!config) return null;
  const stats = statsOf(raw.stats);
  return {
    id: typeof raw.id === "string" && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : `v${raw.n}`,
    n: raw.n,
    at: fin(raw.at) ? raw.at : 0,
    note: clean(raw.note, MAX_NOTE),
    text: raw.text.slice(0, TEXT_MAX),
    answers: answersOf(raw.answers),
    setup: setupOf(raw.setup),
    key: customKey(config),
    config,
    ...(stats ? { stats } : {}),
  };
}

const KNOWN = new Set(["id", "name", "createdAt", "updatedAt", "text", "answers", "symbol", "period", "versions", "live"]);

/** One stored strategy → `StoredStrategy`, or `null` when it cannot be read. */
export function strategyOf(raw: unknown): StoredStrategy | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== "string" || !/^[\w-]{1,40}$/.test(raw.id)) return null;
  if (typeof raw.text !== "string") return null;
  const versions: StudioVersion[] = [];
  if (raw.versions !== undefined) {
    if (!Array.isArray(raw.versions)) return null;
    const ids = new Set<string>();
    for (const v of raw.versions.slice(0, MAX_VERSIONS + 5)) {
      const x = versionOf(v);
      // a version this version cannot read keeps the whole entry untouched (no silent loss of history)
      if (!x) return null;
      if (ids.has(x.id)) continue;
      ids.add(x.id);
      versions.push(x);
    }
    versions.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    // the same number twice (two devices saved "version 3" apart): the later one gets the next free number
    const used = new Set<number>();
    let top = 0;
    for (const v of versions) {
      if (used.has(v.n)) v.n = top + 1;
      used.add(v.n);
      top = Math.max(top, v.n);
    }
    versions.sort((a, b) => a.n - b.n || a.at - b.at);
  }
  const live: LiveLink[] = [];
  if (Array.isArray(raw.live)) {
    for (const l of raw.live.slice(0, MAX_LIVE)) {
      if (isObj(l) && typeof l.accountId === "string" && /^[\w-]{1,40}$/.test(l.accountId)) live.push({ accountId: l.accountId, versionNo: fin(l.versionNo) ? Math.round(l.versionNo) : null, at: fin(l.at) ? l.at : 0 });
    }
  }
  const extra: Raw = {};
  for (const [k, v] of Object.entries(raw)) if (!KNOWN.has(k) && k !== "__proto__") extra[k] = v;
  return {
    id: raw.id,
    name: clean(raw.name, MAX_NAME) || "Meine Strategie",
    createdAt: fin(raw.createdAt) ? raw.createdAt : 0,
    updatedAt: fin(raw.updatedAt) ? raw.updatedAt : 0,
    text: raw.text.slice(0, TEXT_MAX),
    answers: answersOf(raw.answers),
    symbol: typeof raw.symbol === "string" && /^[A-Z0-9]{2,24}$/.test(raw.symbol) ? raw.symbol : DEFAULT_SYMBOL,
    period: (STUDIO_PERIODS as readonly unknown[]).includes(raw.period) ? (raw.period as StudioPeriod) : DEFAULT_PERIOD,
    versions,
    live,
    extra,
  };
}

/** `settings.studio` (anything) → the strategies. A duplicated id keeps the first entry. */
export function studioCfgOf(raw: unknown): StudioCfg {
  if (!isObj(raw)) return EMPTY_STUDIO;
  const strategies: StoredStrategy[] = [];
  const rejected: unknown[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(raw.strategies) ? raw.strategies : []) {
    const s = strategyOf(e);
    if (!s) rejected.push(e);
    else if (!seen.has(s.id) && strategies.length < MAX_STRATEGIES) {
      seen.add(s.id);
      strategies.push(s);
    }
  }
  return { v: STUDIO_VERSION, strategies, rejected };
}

export const studioOfSettings = (s: { studio?: unknown } | null | undefined): StudioCfg => studioCfgOf(s?.studio);

/** A strategy as it is stored (the `extra` keys written back). */
export function storedForm(s: StoredStrategy): Raw {
  return {
    ...s.extra,
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    text: s.text,
    answers: s.answers,
    symbol: s.symbol,
    period: s.period,
    versions: s.versions.map((v) => ({ id: v.id, n: v.n, at: v.at, note: v.note, text: v.text, answers: v.answers, setup: v.setup, key: v.key, config: v.config, ...(v.stats ? { stats: v.stats } : {}) })),
    live: s.live,
  };
}

function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

/**
 * `settings.studio` with the strategies replaced – the unknown keys of the root and the `rejected` entries survive. Returns the
 * SAME object when nothing changes (the caller skips the save).
 */
export function withStrategies(raw: unknown, strategies: readonly StoredStrategy[]): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const cur = studioCfgOf(raw);
  const next: Record<string, unknown> = { ...prev, v: STUDIO_VERSION, strategies: [...strategies.map(storedForm), ...cur.rejected] };
  const same = isObj(raw) && canon(prev) === canon(next);
  return same ? (raw as Record<string, unknown>) : next;
}

/* ------------------------------------------------------------------------------------------ operations */

export interface NewStrategyInput {
  id: string;
  name?: string;
  text?: string;
  answers?: Answers;
  symbol?: string;
  period?: StudioPeriod;
}

export function newStrategy(input: NewStrategyInput, now: number): StoredStrategy {
  return {
    id: input.id,
    name: clean(input.name, MAX_NAME) || "Neue Strategie",
    createdAt: now,
    updatedAt: now,
    text: (input.text ?? "").slice(0, TEXT_MAX),
    answers: answersOf(input.answers),
    symbol: input.symbol && /^[A-Z0-9]{2,24}$/.test(input.symbol) ? input.symbol : DEFAULT_SYMBOL,
    period: input.period ?? DEFAULT_PERIOD,
    versions: [],
    live: [],
    extra: {},
  };
}

/** Why a new strategy cannot be added (`null` = it can). */
export const addError = (list: readonly StoredStrategy[]): string | null => (list.length >= MAX_STRATEGIES ? `Mehr als ${MAX_STRATEGIES} Strategien gehen nicht. Lösche eine, um Platz zu schaffen.` : null);

/** The working copy changed (text, answers, name, market, period). The SAME strategy when nothing differs. */
export function updateDraft(s: StoredStrategy, patch: Partial<Pick<StoredStrategy, "name" | "text" | "answers" | "symbol" | "period">>, now: number): StoredStrategy {
  const next: StoredStrategy = {
    ...s,
    name: patch.name !== undefined ? clean(patch.name, MAX_NAME) || s.name : s.name,
    text: patch.text !== undefined ? patch.text.slice(0, TEXT_MAX) : s.text,
    answers: patch.answers !== undefined ? answersOf(patch.answers) : s.answers,
    symbol: patch.symbol !== undefined && /^[A-Z0-9]{2,24}$/.test(patch.symbol) ? patch.symbol : s.symbol,
    period: patch.period ?? s.period,
  };
  if (canon({ ...next, updatedAt: 0 }) === canon({ ...s, updatedAt: 0 })) return s;
  return { ...next, updatedAt: now };
}

export interface VersionInput {
  text: string;
  answers: Answers;
  setup: StrategySetup;
  config: CustomConfig;
  note?: string;
  stats?: StoredStats;
}

/** Is the version's content (text, answers, rules, market) what the input says? Name and note do not count. */
const sameContent = (v: StudioVersion, input: VersionInput): boolean =>
  v.text === input.text && canon(v.answers) === canon(answersOf(input.answers)) && v.key === customKey(input.config) && v.setup.symbol === input.setup.symbol && v.setup.period === input.setup.period && v.setup.riskPct === input.setup.riskPct;

/**
 * Saves a new version when text, answers or rules changed since the newest one – the SAME strategy when nothing did
 * (saving an unchanged draft is not a version). Numbers never repeat on this device; the oldest versions drop out past `MAX_VERSIONS`.
 */
export function saveVersion(s: StoredStrategy, input: VersionInput, now: number, uid = Math.floor(now % 1e9).toString(36)): StoredStrategy {
  const last = s.versions[s.versions.length - 1];
  if (last && sameContent(last, input)) {
    // the same content again: a run that came later may complete the figures, nothing else changes
    if (input.stats && !last.stats) return { ...s, versions: s.versions.map((v) => (v === last ? { ...v, stats: input.stats } : v)), updatedAt: now };
    return s;
  }
  const n = s.versions.reduce((m, v) => Math.max(m, v.n), 0) + 1;
  const config = parseCustom(input.config).config ?? input.config;
  const v: StudioVersion = {
    id: `v${n}-${uid.replace(/[^\w]/g, "").slice(0, 8) || "x"}`,
    n,
    at: now,
    note: clean(input.note, MAX_NOTE),
    text: input.text.slice(0, TEXT_MAX),
    answers: answersOf(input.answers),
    setup: { symbol: input.setup.symbol, period: input.setup.period, riskPct: input.setup.riskPct },
    key: customKey(config),
    config,
    ...(input.stats ? { stats: input.stats } : {}),
  };
  return { ...s, text: input.text.slice(0, TEXT_MAX), answers: answersOf(input.answers), versions: [...s.versions, v].slice(-MAX_VERSIONS), updatedAt: now };
}

/** Sets the note of one version. */
export function setVersionNote(s: StoredStrategy, n: number, note: string): StoredStrategy {
  return { ...s, versions: s.versions.map((v) => (v.n === n ? { ...v, note: clean(note, MAX_NOTE) } : v)) };
}

/** Attaches backtest figures to a version (the lab's numbers, as computed). */
export function attachStats(s: StoredStrategy, n: number, stats: StoredStats): StoredStrategy {
  return { ...s, versions: s.versions.map((v) => (v.n === n ? { ...v, stats } : v)) };
}

/** Remembers a forward account that was started from `versionNo` (newest first, `MAX_LIVE`). */
export function addLive(s: StoredStrategy, link: LiveLink): StoredStrategy {
  return { ...s, live: [link, ...s.live.filter((l) => l.accountId !== link.accountId)].slice(0, MAX_LIVE) };
}

/** What changed from version `a` to `b` in plain language (the rules, then text and market). Empty = nothing. */
export function diffVersions(a: StudioVersion, b: StudioVersion): string[] {
  const out = diffConfigs(a.config, { ...b.config, name: a.config.name });
  if (a.setup.symbol !== b.setup.symbol) out.push(`Markt: ${a.setup.symbol ?? "–"} → ${b.setup.symbol ?? "–"}`);
  if (a.setup.period !== b.setup.period) out.push(`Zeitraum: ${a.setup.period ?? "–"} → ${b.setup.period ?? "–"}`);
  if (a.setup.riskPct !== b.setup.riskPct) out.push(`Risiko pro Trade: ${a.setup.riskPct ?? "–"} → ${b.setup.riskPct ?? "–"}`);
  if (!out.length && a.text !== b.text) out.push("Nur der Text ist anders – die Regeln sind gleich.");
  return out;
}
