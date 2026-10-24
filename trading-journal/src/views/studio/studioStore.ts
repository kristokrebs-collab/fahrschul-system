/**
 * State of the Strategie-Studio page (memory only – what is kept lives in `settings.studio`):
 * - the EDITOR: the working copy of one strategy (name, text, answers, market, period) and the reading of it (`parsed`); the
 *   working copy of a saved strategy is written back a moment after the last keystroke, the first keystroke of a new text
 *   creates the strategy (a draft without version – a version only arises from "Als Entwurf speichern");
 * - the BACKTEST of the open strategy and the COMPARISON of the selected ones (progress, result, errors);
 * - the strategies tried in this session (they count for the multiple-testing note), the selection, an offered proposal.
 * Every run is aborted by a newer one.
 */
import { create } from "zustand";
import { customKey, sanitizeCustom, validateCustom, type CustomConfig } from "@/domain/lab";
import { sanitizeSignalCfg } from "@/domain/signals";
import {
  DEFAULT_PERIOD,
  DEFAULT_SYMBOL,
  MAX_STRATEGIES,
  parseStrategyText,
  pruneAnswers,
  TEXT_MAX,
  type Answers,
  type CompareInput,
  type StoredStats,
  type StoredStrategy,
  type StrategyParse,
  type StudioPeriod,
} from "@/domain/strategytext";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { compileViaServer } from "./aiClient";
import { resolveEditor, resolveStored, versionMatches, whyNotReady } from "./resolve";
import { runStudioBacktest, runStudioCompare, StudioRunError, type StudioComparison, type StudioRun } from "./runner";
import { saveDraftCopy, saveStrategyVersion, putStats, removeStrategy, strategiesNow } from "./studioWrites";
import { STUDIO } from "./strings";
import type { StudioProposal, StudioStrategy } from "./types";

export interface Editor {
  /** `null` until the first keystroke created the strategy */
  id: string | null;
  name: string;
  text: string;
  answers: Answers;
  symbol: string;
  period: StudioPeriod;
}

export const EMPTY_EDITOR: Editor = { id: null, name: "", text: "", answers: {}, symbol: DEFAULT_SYMBOL, period: DEFAULT_PERIOD };

export type RunStatus = "idle" | "loading" | "running" | "done" | "error" | "cancelled";

export interface BacktestState {
  status: RunStatus;
  progress: number;
  load: { done: number; total: number };
  error: string | null;
  run: StudioRun | null;
  /** bumped per finished run (the equity curve draws again) */
  seq: number;
  /** the strategy and the text the run belongs to */
  forId: string | null;
  forText: string | null;
}

export interface CompareMeta {
  id: string;
  name: string;
  versionNo: number | null;
}

export interface CompareState {
  status: RunStatus;
  progress: number;
  error: string | null;
  run: StudioComparison | null;
  seq: number;
  /** the strategies that were compared, in table order of the run */
  items: CompareMeta[];
  /** selected but not run, with the reason */
  skipped: { id: string; name: string; why: string }[];
}

interface StudioState {
  editor: Editor;
  parsed: StrategyParse | null;
  /** a proposal changed the rules after the reading: its note (the text no longer describes them exactly) */
  override: { note: string } | null;
  ai: { busy: boolean; message: string | null };
  saveError: string | null;
  bt: BacktestState;
  cmp: CompareState;
  cmpSetup: { symbol: string; period: StudioPeriod };
  selected: string[];
  /** `customKey|symbol|period` of every strategy tried in this session */
  tried: string[];
  proposal: StudioProposal | null;

  setEditor(patch: Partial<Omit<Editor, "id">>): void;
  understand(): void;
  choose(askId: string, optionId: string): void;
  understandWithAi(): Promise<void>;
  open(id: string): Promise<void>;
  newDraft(): Promise<void>;
  remove(id: string): Promise<void>;
  save(): Promise<void>;
  runBacktest(): Promise<void>;
  cancelBacktest(): void;
  toggleSelect(id: string): void;
  setSelected(ids: string[]): void;
  setCmpSetup(patch: Partial<{ symbol: string; period: StudioPeriod }>): void;
  runCompare(): Promise<void>;
  cancelCompare(): void;
  propose(p: StudioProposal): void;
  applyProposal(): void;
  dismissProposal(): void;
  backToText(): void;
}

const IDLE_BT: BacktestState = { status: "idle", progress: 0, load: { done: 0, total: 0 }, error: null, run: null, seq: 0, forId: null, forText: null };
const IDLE_CMP: CompareState = { status: "idle", progress: 0, error: null, run: null, seq: 0, items: [], skipped: [] };

/** autosave of the working copy */
const AUTOSAVE_MS = 1200;
let timer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let btCtl: AbortController | null = null;
let cmpCtl: AbortController | null = null;
let lastUi = 0;

const isFresh = (s: Pick<StudioState, "editor" | "parsed">): s is { editor: Editor; parsed: StrategyParse } => s.parsed != null && s.parsed.text === s.editor.text;

export const triedKey = (config: CustomConfig, symbol: string, period: StudioPeriod): string => `${customKey(config)}|${symbol}|${period}`;

function storedStats(run: StudioRun): StoredStats {
  const s = run.result.stats;
  return { n: s.n, winRate: s.winRate, avgR: s.avgR, pf: s.pf === Infinity ? null : s.pf, maxDD: s.maxDD, netPct: s.netPct, symbol: run.symbol, interval: run.result.interval, period: run.period, at: run.at };
}

/** The strategy as the slot panels get it. */
export function strategyView(editor: Editor, parsed: StrategyParse | null, versions: StoredStrategy["versions"]): StudioStrategy {
  const r = resolveEditor(editor, parsed, versions);
  return { id: editor.id, name: editor.name, text: editor.text, answers: editor.answers, rules: r.config, setup: r.setup, symbol: editor.symbol, period: editor.period, interval: r.config.interval, versionNo: versions.length ? versions[versions.length - 1]!.n : null, source: r.source, ready: r.ready };
}

/** Writes the working copy; creates the strategy on the first text. Writes are queued, one after the other. */
function persist(): Promise<void> {
  queue = queue.then(async () => {
    const { editor } = useStudio.getState();
    if (editor.id == null && !editor.text.trim()) return;
    const name = editor.name.trim() || `Strategie ${strategiesNow().length + 1}`;
    const res = await saveDraftCopy(editor.id, { name, text: editor.text, answers: editor.answers, symbol: editor.symbol, period: editor.period });
    if (!res.ok) {
      useStudio.setState({ saveError: res.error });
      return;
    }
    useStudio.setState((s) => {
      // the user opened another strategy while this was written: nothing to adopt
      if (s.editor.id != null && s.editor.id !== res.id) return { saveError: null };
      return { saveError: null, editor: { ...s.editor, id: res.id, name: s.editor.name.trim() ? s.editor.name : name }, bt: s.bt.forId == null && s.bt.run ? { ...s.bt, forId: res.id } : s.bt };
    });
  });
  return queue.then(() => undefined);
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void persist();
  }, AUTOSAVE_MS);
}

/** Writes the working copy now (the page calls it when it unmounts and before it switches or compares). */
export async function flushStudio(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    await persist();
  } else await queue;
}

export const useStudio = create<StudioState>()((set, get) => {
  const flush = flushStudio;

  const loadEditor = (s: StoredStrategy): void => {
    const editor: Editor = { id: s.id, name: s.name, text: s.text, answers: s.answers, symbol: s.symbol, period: s.period };
    const parsed = s.text.trim() ? parseStrategyText(s.text, { answers: s.answers }) : null;
    set({ editor, parsed, override: null, ai: { busy: false, message: null }, saveError: null, bt: IDLE_BT, proposal: null });
  };

  const dropEmpty = async (id: string | null): Promise<void> => {
    if (!id) return;
    const s = strategiesNow().find((x) => x.id === id);
    if (s && s.versions.length === 0 && !s.text.trim()) await removeStrategy(id);
  };

  return {
    editor: EMPTY_EDITOR,
    parsed: null,
    override: null,
    ai: { busy: false, message: null },
    saveError: null,
    bt: IDLE_BT,
    cmp: IDLE_CMP,
    cmpSetup: { symbol: DEFAULT_SYMBOL, period: DEFAULT_PERIOD },
    selected: [],
    tried: [],
    proposal: null,

    setEditor(patch) {
      const cur = get().editor;
      const next: Editor = { ...cur, ...patch, text: (patch.text ?? cur.text).slice(0, TEXT_MAX) };
      if (next.text === cur.text && next.name === cur.name && next.symbol === cur.symbol && next.period === cur.period && next.answers === cur.answers) return;
      set({ editor: next });
      schedule();
    },

    understand() {
      const { editor } = get();
      const p = parseStrategyText(editor.text, { answers: editor.answers });
      const answers = pruneAnswers(p, editor.answers);
      // what the text itself says about market and period is the trader's own word and wins over the fields
      const symbol = p.setup.symbol ?? editor.symbol;
      const period = p.setup.period ?? editor.period;
      set({ parsed: p, override: null, ai: { busy: false, message: null }, editor: { ...editor, answers, symbol, period } });
      schedule();
    },

    choose(askId, optionId) {
      const s = get();
      if (!isFresh(s) || s.parsed.source === "ai") return;
      const answers = { ...s.editor.answers, [askId]: optionId };
      const p = parseStrategyText(s.editor.text, { answers });
      set({ parsed: p, override: null, editor: { ...s.editor, answers: pruneAnswers(p, answers), symbol: p.setup.symbol ?? s.editor.symbol, period: p.setup.period ?? s.editor.period } });
      schedule();
    },

    async understandWithAi() {
      const { editor, ai } = get();
      if (ai.busy || !editor.text.trim()) return;
      set({ ai: { busy: true, message: null } });
      const out = await compileViaServer(editor.text);
      // the text changed while the server worked: the answer belongs to the old text
      if (get().editor.text !== editor.text) {
        set({ ai: { busy: false, message: null } });
        return;
      }
      if (!out.ok) {
        set({ ai: { busy: false, message: out.message } });
        return;
      }
      const p = out.parse;
      set((s) => ({ parsed: p, override: null, ai: { busy: false, message: null }, editor: { ...s.editor, answers: {}, symbol: p.setup.symbol ?? s.editor.symbol, period: p.setup.period ?? s.editor.period } }));
      schedule();
    },

    async open(id) {
      await flush();
      const prev = get().editor.id;
      const target = strategiesNow().find((s) => s.id === id);
      if (!target) return;
      if (prev !== id) await dropEmpty(prev);
      btCtl?.abort();
      loadEditor(target);
      // as long as nothing is picked for a comparison, its market and period follow the strategy being worked on
      if (get().selected.length === 0) set({ cmpSetup: { symbol: target.symbol, period: target.period } });
    },

    async newDraft() {
      await flush();
      const prev = get().editor.id;
      await dropEmpty(prev);
      btCtl?.abort();
      set({ editor: EMPTY_EDITOR, parsed: null, override: null, ai: { busy: false, message: null }, saveError: null, bt: IDLE_BT, proposal: null });
    },

    async remove(id) {
      if (get().editor.id === id) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        await queue;
        btCtl?.abort();
        set({ editor: EMPTY_EDITOR, parsed: null, override: null, bt: IDLE_BT, proposal: null });
      }
      const ok = await removeStrategy(id);
      set((s) => ({ selected: s.selected.filter((x) => x !== id) }));
      if (!ok) pushToast({ kind: "error", title: STUDIO.list.removeFailed });
    },

    async save() {
      const s0 = get();
      if (!s0.editor.text.trim()) {
        pushToast({ kind: "info", title: STUDIO.backtest.needsText });
        return;
      }
      if (!isFresh(s0)) get().understand();
      await flush();
      const s = get();
      const p = s.parsed!;
      const { editor } = s;
      const name = editor.name.trim() || `Strategie ${strategiesNow().length + 1}`;
      // figures of a run on exactly these rules travel with the version
      const run = s.bt.run;
      const stats = run && customKey(run.config) === customKey(p.rules) && s.bt.forText === editor.text ? storedStats(run) : undefined;
      const res = await saveStrategyVersion(
        editor.id,
        { name, text: editor.text, answers: editor.answers, symbol: editor.symbol, period: editor.period },
        { text: editor.text, answers: editor.answers, setup: p.setup, config: sanitizeCustom(p.rules), ...(s.override ? { note: s.override.note } : {}), ...(stats ? { stats } : {}) },
      );
      if (!res.ok) {
        set({ saveError: res.error });
        pushToast({ kind: "error", title: STUDIO.editor.saveFailed, detail: res.error });
        return;
      }
      set((x) => ({ saveError: null, editor: { ...x.editor, id: res.id, name }, bt: x.bt.forId == null && x.bt.run ? { ...x.bt, forId: res.id } : x.bt }));
      if (res.created) pushToast({ kind: "success", title: STUDIO.editor.savedToast(name, res.versionNo) });
      else pushToast({ kind: "info", title: STUDIO.editor.unchanged });
    },

    async runBacktest() {
      let s = get();
      if (!s.editor.text.trim()) {
        set({ bt: { ...s.bt, status: "error", error: STUDIO.backtest.needsText } });
        return;
      }
      if (!isFresh(s)) {
        get().understand();
        s = get();
      }
      const p = s.parsed!;
      const why = whyNotReady(p.rules, p);
      if (why) {
        set({ bt: { ...s.bt, status: "error", error: `${STUDIO.backtest.needsReady} ${why}` } });
        return;
      }
      btCtl?.abort();
      const mine = new AbortController();
      btCtl = mine;
      const { editor } = s;
      const forId = editor.id;
      const forText = editor.text;
      set({ bt: { ...IDLE_BT, status: "loading", seq: s.bt.seq, run: s.bt.forId === forId ? s.bt.run : null, forId, forText } });
      try {
        const run = await runStudioBacktest({
          config: p.rules,
          symbol: editor.symbol,
          period: editor.period,
          riskPct: p.setup.riskPct,
          signal: sanitizeSignalCfg(useJournal.getState().settings.signals),
          abort: mine.signal,
          onProgress: (q) => {
            const t = Date.now();
            if (btCtl !== mine || (t - lastUi < 120 && q.fraction < 1)) return;
            lastUi = t;
            set((x) => ({ bt: { ...x.bt, status: q.stage === "load" ? "loading" : "running", progress: q.fraction, load: q.stage === "load" ? { done: q.done, total: q.total } : x.bt.load } }));
          },
        });
        if (btCtl !== mine) return;
        const key = triedKey(run.config, run.symbol, run.period);
        set((x) => ({ bt: { status: "done", progress: 1, load: x.bt.load, error: null, run, seq: x.bt.seq + 1, forId: get().editor.id, forText }, tried: x.tried.includes(key) ? x.tried : [...x.tried, key] }));
        // the figures belong to the saved version whose rules these are
        const id = get().editor.id;
        const st = id ? strategiesNow().find((z) => z.id === id) : undefined;
        const last = st?.versions[st.versions.length - 1];
        if (st && last && versionMatches(last, forText, get().editor.answers) && last.key === customKey(run.config)) await putStats(st.id, last.n, storedStats(run));
      } catch (e) {
        if (btCtl !== mine) return;
        const cancelled = e instanceof StudioRunError && e.kind === "cancelled";
        set((x) => ({ bt: { ...x.bt, status: cancelled ? "cancelled" : "error", error: e instanceof StudioRunError ? e.message : STUDIO.backtest.errors.failed, progress: 0 } }));
      } finally {
        if (btCtl === mine) btCtl = null;
      }
    },

    cancelBacktest() {
      btCtl?.abort();
    },

    toggleSelect(id) {
      set((s) => ({ selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id].slice(0, MAX_STRATEGIES) }));
    },
    setSelected: (ids) => set({ selected: ids.slice(0, MAX_STRATEGIES) }),
    setCmpSetup: (patch) => set((s) => ({ cmpSetup: { ...s.cmpSetup, ...patch } })),

    async runCompare() {
      await flush();
      const s = get();
      const list = strategiesNow().filter((x) => s.selected.includes(x.id));
      const items: CompareInput[] = [];
      const meta: CompareMeta[] = [];
      const skipped: CompareState["skipped"] = [];
      for (const st of list) {
        const r = st.id === s.editor.id ? resolveEditor(s.editor, s.parsed, st.versions) : resolveStored(st);
        if (!r.ready || !st.text.trim()) {
          skipped.push({ id: st.id, name: st.name, why: r.why ?? STUDIO.backtest.needsText });
          continue;
        }
        items.push({ id: st.id, name: st.name, config: r.config });
        meta.push({ id: st.id, name: st.name, versionNo: r.versionNo });
      }
      if (items.length < 2) {
        set({ cmp: { ...IDLE_CMP, status: "error", error: items.length === 0 && skipped.length === 0 ? STUDIO.compare.pickNone : STUDIO.compare.needTwo, skipped, seq: s.cmp.seq } });
        return;
      }
      cmpCtl?.abort();
      const mine = new AbortController();
      cmpCtl = mine;
      const { symbol, period } = s.cmpSetup;
      const here = new Set(items.map((i) => triedKey(i.config, symbol, period)));
      const extra = s.tried.filter((k) => !here.has(k)).length;
      set({ cmp: { ...IDLE_CMP, status: "loading", seq: s.cmp.seq, items: meta, skipped, run: null } });
      try {
        const run = await runStudioCompare({
          items,
          symbol,
          period,
          signal: sanitizeSignalCfg(useJournal.getState().settings.signals),
          abort: mine.signal,
          extraTrials: extra,
          onProgress: (f) => {
            const t = Date.now();
            if (cmpCtl !== mine || (t - lastUi < 120 && f < 1)) return;
            lastUi = t;
            set((x) => ({ cmp: { ...x.cmp, status: f < 0.2 ? "loading" : "running", progress: f } }));
          },
        });
        if (cmpCtl !== mine) return;
        set((x) => ({ cmp: { ...x.cmp, status: "done", progress: 1, run, seq: x.cmp.seq + 1, error: null }, tried: [...x.tried, ...[...here].filter((k) => !x.tried.includes(k))] }));
      } catch (e) {
        if (cmpCtl !== mine) return;
        const cancelled = e instanceof StudioRunError && e.kind === "cancelled";
        set((x) => ({ cmp: { ...x.cmp, status: cancelled ? "cancelled" : "error", error: e instanceof StudioRunError ? e.message : STUDIO.backtest.errors.failed, progress: 0 } }));
      } finally {
        if (cmpCtl === mine) cmpCtl = null;
      }
    },

    cancelCompare() {
      cmpCtl?.abort();
    },

    propose: (proposal) => set({ proposal }),
    dismissProposal: () => set({ proposal: null }),
    applyProposal() {
      const { proposal, parsed, editor } = get();
      if (!proposal) return;
      const rules = sanitizeCustom({ ...proposal.config, name: parsed?.rules.name ?? proposal.config.name });
      const base = parsed && parsed.text === editor.text ? parsed : parseStrategyText(editor.text, { answers: editor.answers });
      const issues = validateCustom(rules);
      set({ parsed: { ...base, rules, issues, ready: !issues.some((i) => i.level === "error") }, override: { note: proposal.note.slice(0, 140) }, proposal: null });
    },
    backToText() {
      get().understand();
    },
  };
});

/** Test hook: the page forgets everything it holds in memory. */
export function __resetStudio(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  queue = Promise.resolve();
  btCtl?.abort();
  cmpCtl?.abort();
  btCtl = null;
  cmpCtl = null;
  useStudio.setState({ editor: EMPTY_EDITOR, parsed: null, override: null, ai: { busy: false, message: null }, saveError: null, bt: IDLE_BT, cmp: IDLE_CMP, cmpSetup: { symbol: DEFAULT_SYMBOL, period: DEFAULT_PERIOD }, selected: [], tried: [], proposal: null });
}
