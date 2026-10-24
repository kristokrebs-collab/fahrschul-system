/**
 * State of the Labor page (P07): the experiment set-up (remembered per viewer in localStorage – a convenience, the page
 * works without it), the running job (phase, progress), the result and the bars it was computed on (memory only, for the
 * replay), and compact summaries of the last runs (localStorage, for the comparison).
 *
 * `startLab(signalCfg)` loads the real history (`historySource.ts`) and runs the job (`runLab`: worker, idle chunks
 * under file://); `cancelLab()` aborts both. A newer start aborts an older run.
 */
import { create } from "zustand";
import {
  completeParams,
  DEFAULT_FUNDING_RATE,
  estimatePages,
  feePreset,
  fundingModelOf,
  isLabAbort,
  runLab,
  sourceIntervals,
  strategyCfg,
  strategyOf,
  type Bar,
  type EquityPoint,
  type HistInterval,
  type LabJobInput,
  type LabPhase,
  type LabResult,
  type LabStrategyId,
  type Params,
  type RobustVerdict,
  type RuleCond,
  type SlippageModel,
} from "@/domain/backtest/index";
import { activeLeaves, defaultCustom, parseCustom, sanitizeCustom, validateCustom, type CustomConfig, type IdeaDraft } from "@/domain/lab";
import type { SignalCfg } from "@/domain/signals";
import { storageKey } from "@/store/storage";
import { isFileProtocol, IS_FILE_BUILD } from "@/edition";
import { loadErrorKind, loadLabData } from "./historySource";
import { LABOR, type LaborPeriod } from "./strings";
import { __resetVersions, useVersions } from "./versionsStore";

export type FundingMode = "history" | "flat" | "none";

export interface LabConfig {
  strategy: LabStrategyId;
  symbol: string;
  period: LaborPeriod;
  boxTf: "4h" | "1d";
  mcbStep: "4h" | "1h";
  rules: { interval: "1h" | "4h" | "1d"; side: "long" | "short"; conds: RuleCond[] };
  /** "Eigene Idee": the rule tree being edited (versioned, see `@/domain/lab`) */
  custom: CustomConfig;
  params: Partial<Record<LabStrategyId, Params>>;
  exchange: string;
  slippage: SlippageModel;
  funding: FundingMode;
  capital: number;
  /** percent (1 = 1 %) */
  riskPct: number;
  maxLeverage: number;
}

export const DEFAULT_LAB: LabConfig = {
  strategy: "box",
  symbol: "BTCUSDT",
  period: "1y",
  boxTf: "4h",
  mcbStep: "4h",
  rules: { interval: "4h", side: "long", conds: [{ kind: "rsiBelow", a: 30 }, { kind: "closeAboveEma", a: 200 }] },
  custom: defaultCustom(),
  params: { box: { target: 1, maxBars: 42, minGrade: "A", kinds: "alle" }, mcb: { targetR: 2, stopAtr: 1.5, minStrength: 3, maxBars: 30 }, rules: { targetR: 2, stopAtr: 1.5, maxBars: 30 } },
  exchange: "binance",
  slippage: { kind: "fixed", bps: 2 },
  funding: "history",
  capital: 10_000,
  riskPct: 1,
  maxLeverage: 5,
};

export const PERIOD_DAYS: Readonly<Record<LaborPeriod, number>> = { "3m": 91, "6m": 182, "1y": 365, "2y": 730, "3y": 1095 };

export type LabStatus = "idle" | "loading" | "running" | "done" | "error" | "cancelled";

/** Where a draft came from when it is not the trader's own: an imported playbook (F13 / F45). Such a draft stays marked "fremd". */
export interface DraftOrigin {
  kind: "playbook";
  /** the title in the file */
  title: string;
  author: string | null;
  /** ms */
  importedAt: number;
  /** `customKey` of the rules as imported */
  key: string;
}

/** A named, saved version of the custom idea (kept in the browser like the other lab settings). */
export interface CustomDraft {
  id: string;
  name: string;
  savedAt: number;
  config: CustomConfig;
  /** set for an imported playbook, absent for the trader's own ideas */
  origin?: DraftOrigin;
}

export const DRAFTS_MAX = 24;

const FUNDING_MISSING = "Die Funding-Historie konnte nicht geladen werden. Der Baustein „Funding-Extrem“ braucht sie – ohne sie würde die Idee nie handeln. Versuche es noch einmal oder entferne den Baustein.";

/**
 * An idea handed over by "Diese Idee testen" (F12): the draft with its mapped / not-mapped lists and the set-up it replaced
 * (so the trader can step back). Memory only – nothing of it is saved until the trader saves a draft.
 */
export interface IdeaOrigin {
  draft: IdeaDraft;
  before: { strategy: LabStrategyId; symbol: string; custom: CustomConfig };
}

export interface RunSummary {
  id: string;
  at: number;
  strategy: LabStrategyId;
  /** name of the custom idea */
  name?: string | null;
  symbol: string;
  interval: string;
  period: LaborPeriod;
  specs: { label: string; value: string }[];
  n: number;
  winRate: number | null;
  avgR: number | null;
  netPct: number;
  maxDD: number;
  pf: number | null;
  verdict: RobustVerdict;
  /** equity in % of the start capital, ≤ 48 points */
  curve: number[];
}

interface LaborState {
  cfg: LabConfig;
  status: LabStatus;
  phase: LabPhase | "load";
  progress: number;
  load: { done: number; total: number };
  error: string | null;
  result: LabResult | null;
  /** execution bars of the result (index space of its trades) – memory only */
  bars: readonly Bar[];
  /** bumped per finished run (effect replay key) */
  runSeq: number;
  runs: RunSummary[];
  replayId: string | null;
  fundingUsed: "history" | "flat" | "none" | null;
  /** the set-up the shown result was computed with (the assumptions card reads it) */
  runCfg: LabConfig | null;
  /** saved versions of the custom idea */
  drafts: CustomDraft[];
  /** the idea the set-up was filled from (F12), `null` = the trader built it */
  idea: IdeaOrigin | null;
  /** fills strategy "Eigene Idee", market and rules from an idea; `false` (nothing changed) when it is not testable */
  applyIdea(draft: IdeaDraft): boolean;
  /** puts the set-up back that the idea replaced */
  restoreBeforeIdea(): void;
  dismissIdea(): void;
  setCfg(patch: Partial<LabConfig>): void;
  /** edits the custom idea (the result is sanitised and remembered) */
  setCustom(next: CustomConfig | ((c: CustomConfig) => CustomConfig)): void;
  /** saves the current idea under `name` (same name = overwritten); null when the list is full */
  saveDraft(name?: string): string | null;
  /** adds an imported playbook as a new, marked draft; null when the list is full */
  addForeignDraft(name: string, config: CustomConfig, origin: DraftOrigin): string | null;
  /** adds rules as a NEW draft of the trader's own (e.g. a proposal of the optimiser the trader saved); the editor stays as it is; null when the list is full */
  addDraft(name: string, config: CustomConfig, note: string): string | null;
  /** puts the rules (and the name) of a draft back to `config`; false when the draft is gone */
  replaceDraftConfig(id: string, config: CustomConfig): boolean;
  loadDraft(id: string): boolean;
  duplicateDraft(id: string): string | null;
  deleteDraft(id: string): void;
  setParam(strategy: LabStrategyId, key: string, value: string | number): void;
  openReplay(id: string | null): void;
  clearRuns(): void;
}

const CFG_KEY = storageKey("labor");
const RUNS_KEY = storageKey("labor-runs");
const DRAFTS_KEY = storageKey("labor-drafts");
export const RUNS_MAX = 6;

function readJson<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode / quota: works without remembering */
  }
}

/** Saved drafts: versioned wrapper, every config parsed with `parseCustom` (unknown versions / broken items are dropped). */
export function readDrafts(): CustomDraft[] {
  const raw = readJson<{ v?: number; items?: unknown }>(DRAFTS_KEY);
  if (!raw || raw.v !== 1 || !Array.isArray(raw.items)) return [];
  const out: CustomDraft[] = [];
  for (const it of raw.items) {
    if (!it || typeof it !== "object") continue;
    const d = it as Partial<CustomDraft>;
    const { config } = parseCustom(d.config);
    if (config && typeof d.id === "string" && typeof d.name === "string") {
      const item: CustomDraft = { id: d.id, name: d.name.slice(0, 60), savedAt: typeof d.savedAt === "number" ? d.savedAt : 0, config };
      const o = d.origin as Partial<DraftOrigin> | undefined;
      if (o && o.kind === "playbook" && typeof o.title === "string") {
        item.origin = { kind: "playbook", title: o.title.slice(0, 80), author: typeof o.author === "string" ? o.author.slice(0, 40) : null, importedAt: typeof o.importedAt === "number" ? o.importedAt : 0, key: typeof o.key === "string" ? o.key.slice(0, 20) : "" };
      }
      out.push(item);
    }
  }
  return out.slice(0, DRAFTS_MAX);
}

function writeDrafts(items: CustomDraft[]): void {
  writeJson(DRAFTS_KEY, { v: 1, items });
}

const nextDraftId = (items: readonly CustomDraft[]): string => `d${items.reduce((m, d) => Math.max(m, Number(d.id.slice(1)) || 0), 0) + 1}`;

/** Saved set-up merged over the defaults (unknown / broken values fall back). */
export function sanitizeCfg(raw: unknown): LabConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<LabConfig>;
  const pick = <T>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : d);
  const rules = r.rules && typeof r.rules === "object" ? r.rules : DEFAULT_LAB.rules;
  return {
    strategy: pick(r.strategy, ["custom", "box", "mcb", "rules"] as const, DEFAULT_LAB.strategy),
    symbol: typeof r.symbol === "string" && /^[A-Z0-9]{2,24}$/.test(r.symbol) ? r.symbol : DEFAULT_LAB.symbol,
    period: pick(r.period, ["3m", "6m", "1y", "2y", "3y"] as const, DEFAULT_LAB.period),
    boxTf: pick(r.boxTf, ["4h", "1d"] as const, DEFAULT_LAB.boxTf),
    mcbStep: pick(r.mcbStep, ["4h", "1h"] as const, DEFAULT_LAB.mcbStep),
    rules: {
      interval: pick(rules.interval, ["1h", "4h", "1d"] as const, "4h"),
      side: pick(rules.side, ["long", "short"] as const, "long"),
      conds: Array.isArray(rules.conds) ? rules.conds.filter((c) => c && typeof c === "object" && typeof (c as RuleCond).kind === "string").slice(0, 6) : DEFAULT_LAB.rules.conds,
    },
    custom: r.custom && typeof r.custom === "object" ? sanitizeCustom(r.custom) : defaultCustom(),
    params: { ...DEFAULT_LAB.params, ...(r.params && typeof r.params === "object" ? r.params : {}) },
    exchange: typeof r.exchange === "string" ? feePreset(r.exchange).exchange : DEFAULT_LAB.exchange,
    slippage: r.slippage && typeof r.slippage === "object" && ["fixed", "atr", "spread", "none"].includes((r.slippage as SlippageModel).kind) ? (r.slippage as SlippageModel) : DEFAULT_LAB.slippage,
    funding: pick(r.funding, ["history", "flat", "none"] as const, DEFAULT_LAB.funding),
    capital: num(r.capital, 100, 1e9, DEFAULT_LAB.capital),
    riskPct: num(r.riskPct, 0.05, 10, DEFAULT_LAB.riskPct),
    maxLeverage: num(r.maxLeverage, 1, 125, DEFAULT_LAB.maxLeverage),
  };
}

export const useLabor = create<LaborState>()((set, get) => ({
  cfg: sanitizeCfg(readJson(CFG_KEY)),
  status: "idle",
  phase: "load",
  progress: 0,
  load: { done: 0, total: 0 },
  error: null,
  result: null,
  bars: [],
  runSeq: 0,
  runs: (readJson<RunSummary[]>(RUNS_KEY) ?? []).filter((r) => r && typeof r.id === "string").slice(0, RUNS_MAX),
  replayId: null,
  fundingUsed: null,
  runCfg: null,
  drafts: readDrafts(),
  idea: null,
  applyIdea(draft) {
    if (!draft.testable) return false;
    const cur = get().cfg;
    // a second idea on top of the first keeps the trader's own set-up as the way back
    const before = get().idea?.before ?? { strategy: cur.strategy, symbol: cur.symbol, custom: cur.custom };
    get().setCfg({ strategy: "custom", custom: draft.config, ...(draft.symbol ? { symbol: draft.symbol } : {}) });
    set({ idea: { draft, before } });
    return true;
  },
  restoreBeforeIdea() {
    const o = get().idea;
    if (!o) return;
    get().setCfg({ strategy: o.before.strategy, symbol: o.before.symbol, custom: o.before.custom });
    set({ idea: null });
  },
  dismissIdea: () => set({ idea: null }),
  setCustom(next) {
    const cur = get().cfg.custom;
    get().setCfg({ custom: typeof next === "function" ? next(cur) : next });
  },
  saveDraft(name) {
    const cfg = get().cfg;
    const title = (name ?? cfg.custom.name).trim().slice(0, 60) || "Meine Idee";
    const config = sanitizeCustom({ ...cfg.custom, name: title });
    const list = get().drafts;
    const same = list.find((d) => d.name === title);
    if (!same && list.length >= DRAFTS_MAX) return null;
    const id = same?.id ?? nextDraftId(list);
    const item: CustomDraft = { id, name: title, savedAt: Date.now(), config, ...(same?.origin ? { origin: same.origin } : {}) };
    const drafts = same ? list.map((d) => (d.id === id ? item : d)) : [item, ...list];
    writeDrafts(drafts);
    set({ drafts });
    useVersions.getState().record(id, config, "", item.savedAt);
    get().setCfg({ custom: config });
    return id;
  },
  addForeignDraft(name, config, origin) {
    const list = get().drafts;
    if (list.length >= DRAFTS_MAX) return null;
    const base = name.trim().slice(0, 52) || "Playbook";
    let title = base;
    for (let k = 2; list.some((x) => x.name === title); k++) title = `${base} (${k})`;
    const item: CustomDraft = { id: nextDraftId(list), name: title, savedAt: Date.now(), config: sanitizeCustom({ ...config, name: title }), origin };
    const drafts = [item, ...list];
    writeDrafts(drafts);
    set({ drafts });
    useVersions.getState().record(item.id, item.config, "Importiertes Playbook", item.savedAt);
    return item.id;
  },
  addDraft(name, config, note) {
    const list = get().drafts;
    if (list.length >= DRAFTS_MAX) return null;
    const base = name.trim().slice(0, 52) || "Neue Idee";
    let title = base;
    for (let k = 2; list.some((x) => x.name === title); k++) title = `${base} (${k})`;
    const item: CustomDraft = { id: nextDraftId(list), name: title, savedAt: Date.now(), config: sanitizeCustom({ ...config, name: title }) };
    const drafts = [item, ...list];
    writeDrafts(drafts);
    set({ drafts });
    useVersions.getState().record(item.id, item.config, note, item.savedAt);
    return item.id;
  },
  replaceDraftConfig(id, config) {
    const list = get().drafts;
    const d = list.find((x) => x.id === id);
    if (!d) return false;
    const clean = sanitizeCustom(config);
    const drafts = list.map((x) => (x.id === id ? { ...x, name: clean.name, savedAt: Date.now(), config: clean } : x));
    writeDrafts(drafts);
    set({ drafts });
    return true;
  },
  loadDraft(id) {
    const d = get().drafts.find((x) => x.id === id);
    if (!d) return false;
    get().setCfg({ strategy: "custom", custom: d.config });
    return true;
  },
  duplicateDraft(id) {
    const list = get().drafts;
    const d = list.find((x) => x.id === id);
    if (!d || list.length >= DRAFTS_MAX) return null;
    let name = `${d.name} (Kopie)`.slice(0, 60);
    for (let k = 2; list.some((x) => x.name === name); k++) name = `${d.name} (Kopie ${k})`.slice(0, 60);
    const copy: CustomDraft = { id: nextDraftId(list), name, savedAt: Date.now(), config: { ...d.config, name }, ...(d.origin ? { origin: d.origin } : {}) };
    const drafts = [copy, ...list];
    writeDrafts(drafts);
    set({ drafts });
    useVersions.getState().record(copy.id, copy.config, `Kopie von „${d.name}“`, copy.savedAt);
    return copy.id;
  },
  deleteDraft(id) {
    const drafts = get().drafts.filter((d) => d.id !== id);
    writeDrafts(drafts);
    set({ drafts });
    useVersions.getState().drop(id);
  },
  setCfg(patch) {
    const cfg = sanitizeCfg({ ...get().cfg, ...patch });
    writeJson(CFG_KEY, cfg);
    set({ cfg });
  },
  setParam(strategy, key, value) {
    const cfg = get().cfg;
    get().setCfg({ params: { ...cfg.params, [strategy]: { ...(cfg.params[strategy] ?? {}), [key]: value } } });
  },
  openReplay: (replayId) => set({ replayId }),
  clearRuns() {
    writeJson(RUNS_KEY, []);
    set({ runs: [] });
  },
}));

// drafts saved before versions existed get a first version, so the first change after this is a second one (F15)
useVersions.getState().seed(useLabor.getState().drafts);

/** Execution / loaded intervals and warm-up of a set-up. */
export function planOf(cfg: LabConfig, signal: SignalCfg): { input: Omit<LabJobInput, "data" | "engine" | "fromMs" | "toMs">; intervals: HistInterval[]; warmupMs: number } {
  const base = {
    strategy: cfg.strategy,
    symbol: cfg.symbol,
    box: { tf: cfg.boxTf },
    mcb: { signal, step: cfg.mcbStep },
    rules: { interval: cfg.rules.interval, side: cfg.rules.side, conds: cfg.rules.conds },
    custom: { config: cfg.custom, signal },
    // the custom idea carries its own stop / target: the optimiser's first option IS the configured value
    params: cfg.strategy === "custom" ? {} : (cfg.params[cfg.strategy] ?? {}),
  };
  const strat = strategyOf(cfg.strategy);
  const scfg = strategyCfg(base);
  return { input: { ...base, params: completeParams(strat.specs(scfg), base.params) }, intervals: strat.intervals(scfg), warmupMs: strat.warmupMs(scfg) };
}

/** Upper bound of the Binance pages a run needs (without the cache). */
export function pagesEstimate(cfg: LabConfig, signal: SignalCfg, now = Date.now()): number {
  const p = planOf(cfg, signal);
  const from = now - PERIOD_DAYS[cfg.period] * 86_400_000 - p.warmupMs;
  return sourceIntervals(p.intervals).reduce((s, iv) => s + estimatePages(iv, from, now), 0);
}

let ctl: AbortController | null = null;
let lastUi = 0;
/**
 * The job input of the SHOWN result (data, engine, parameters, period) – memory only. The extra runs of the lab (stress
 * scenarios F20, filter comparison F17) repeat exactly this set-up; without it there is nothing to repeat.
 */
let shownInput: LabJobInput | null = null;

/** The input the shown result was computed with, or null before a run (and after a reset). */
export function shownRunInput(): LabJobInput | null {
  return shownInput;
}

/** Starts a run (aborting a running one). */
export async function startLab(signal: SignalCfg, now = Date.now()): Promise<void> {
  ctl?.abort();
  const mine = new AbortController();
  ctl = mine;
  const cfg = useLabor.getState().cfg;
  if (cfg.strategy === "custom" && validateCustom(cfg.custom, { funding: cfg.funding === "history" }).some((i) => i.level === "error")) {
    useLabor.setState({ status: "error", error: LABOR.errors.invalidIdea, progress: 0 });
    if (ctl === mine) ctl = null;
    return;
  }
  const plan = planOf(cfg, signal);
  const fromMs = now - PERIOD_DAYS[cfg.period] * 86_400_000;
  let stage: "load" | "run" = "load";
  useLabor.setState({ status: "loading", phase: "load", progress: 0, load: { done: 0, total: 0 }, error: null, replayId: null });
  try {
    const loaded = await loadLabData({
      symbol: cfg.symbol,
      intervals: plan.intervals,
      from: fromMs - plan.warmupMs,
      to: now,
      funding: cfg.funding === "history",
      signal: mine.signal,
      onProgress: (done, total) => {
        if (ctl === mine) useLabor.setState({ load: { done, total }, progress: total ? Math.min(1, done / total) * 0.15 : 0 });
      },
    });
    if (ctl !== mine) return;
    const exec = loaded.data[plan.intervals[0]!] ?? [];
    if (exec.length < 120) {
      useLabor.setState({ status: "error", error: LABOR.errors.noData });
      return;
    }
    const fundingUsed: LaborState["fundingUsed"] = cfg.funding === "none" ? "none" : cfg.funding === "history" && loaded.funding ? "history" : "flat";
    // the block „Funding-Extrem“ reads the real history only: without it the idea would silently never trade
    if (cfg.strategy === "custom" && fundingUsed !== "history" && activeLeaves(cfg.custom).some((l) => l.block === "funding")) {
      useLabor.setState({ status: "error", error: FUNDING_MISSING, progress: 0 });
      return;
    }
    const fee = feePreset(cfg.exchange);
    const input: LabJobInput = {
      ...plan.input,
      fromMs,
      toMs: now,
      data: loaded.data,
      engine: {
        capital: cfg.capital,
        riskPct: cfg.riskPct / 100,
        maxLeverage: cfg.maxLeverage,
        compounding: true,
        costs: { fees: { exchange: fee.exchange, makerBps: fee.makerBps, takerBps: fee.takerBps }, slippage: cfg.slippage, funding: fundingUsed === "none" ? { kind: "none" } : fundingModelOf(fundingUsed === "history" ? loaded.funding : null, DEFAULT_FUNDING_RATE) },
      },
    };
    useLabor.setState({ status: "running", phase: "signals", progress: 0.15 });
    stage = "run";
    const result = await runLab(input, {
      signal: mine.signal,
      onProgress: (p, phase) => {
        // ≤ ~8 UI updates per second (the loader's digits and the phase label)
        const t = Date.now();
        if (ctl !== mine || t - lastUi < 120) return;
        lastUi = t;
        useLabor.setState({ phase, progress: 0.15 + 0.85 * p });
      },
    });
    if (ctl !== mine) return;
    const summary = summarize(result, cfg.period);
    const runs = [summary, ...useLabor.getState().runs.filter((r) => r.id !== summary.id)].slice(0, RUNS_MAX);
    writeJson(RUNS_KEY, runs);
    shownInput = input;
    useLabor.setState((s) => ({ status: "done", phase: "done", progress: 1, result, bars: exec, runSeq: s.runSeq + 1, runs, fundingUsed, runCfg: cfg }));
  } catch (e) {
    if (ctl !== mine) return;
    if (isLabAbort(e) || (e instanceof Error && e.name === "AbortError")) {
      useLabor.setState({ status: "cancelled", error: LABOR.cancelled, progress: 0 });
      return;
    }
    // a failure of the computation itself is never blamed on the network
    const kind = stage === "run" ? "failed" : loadErrorKind(e);
    if (stage === "run") console.error("Labor: Lauf fehlgeschlagen", e);
    const msg = kind === "blocked" ? (IS_FILE_BUILD || isFileProtocol() ? LABOR.errors.blockedFile : LABOR.errors.blocked) : kind === "rate" ? LABOR.errors.rate : kind === "symbol" ? LABOR.errors.symbol : LABOR.errors.failed;
    useLabor.setState({ status: "error", error: msg, progress: 0 });
  } finally {
    if (ctl === mine) ctl = null;
  }
}

export function cancelLab(): void {
  ctl?.abort();
}

function summarize(r: LabResult, period: LaborPeriod): RunSummary {
  const cap = r.equity[0]?.equity ?? 1;
  const step = Math.max(1, Math.ceil(r.equity.length / 48));
  const curve = r.equity.filter((_, i) => i % step === 0 || i === r.equity.length - 1).map((p: EquityPoint) => (cap > 0 ? (p.equity / cap - 1) * 100 : 0));
  return {
    id: `${r.strategy}${r.configKey ? `#${r.configKey}` : ""}:${r.symbol}:${r.interval}:${period}:${r.specs.map((s) => s.value).join("|")}`,
    at: Date.now(),
    strategy: r.strategy,
    name: r.name,
    symbol: r.symbol,
    interval: r.interval,
    period,
    specs: r.specs.map(({ label, value }) => ({ label, value })),
    n: r.stats.n,
    winRate: r.stats.winRate,
    avgR: r.stats.avgR,
    netPct: r.stats.netPct,
    maxDD: r.stats.maxDD,
    pf: r.stats.pf === Infinity ? null : r.stats.pf,
    verdict: r.robust.verdict,
    curve,
  };
}

/** Test hook. */
export function __resetLabor(): void {
  __resetVersions();
  ctl?.abort();
  ctl = null;
  shownInput = null;
  useLabor.setState({ cfg: DEFAULT_LAB, drafts: [], status: "idle", phase: "load", progress: 0, load: { done: 0, total: 0 }, error: null, result: null, bars: [], runSeq: 0, runs: [], replayId: null, fundingUsed: null, runCfg: null, idea: null });
}
