/**
 * State of the Papier-Portfolio of the Branchen-Trend (C1): the book of paper positions (kept on this device), the candidate checks
 * that are running or done, and the actions – check a signal, open THE position, close it. The rules are `@/domain/industryTrend/paper`
 * (pure); this file fetches the instrument's candles, runs the Zeitmaschine, saves the simulation (`tradeId` = the position's id) and
 * writes the book. Nothing here sends an order anywhere.
 */
import { create } from "zustand";
import {
  closePosition,
  decide,
  emptyBook,
  bookOfStored,
  instrumentOf,
  MAX_POSITIONS,
  openPosition,
  planFromBars,
  positionForRed,
  positionIdOf,
  type CheckPlan,
  type Decision,
  type PaperBook,
  type PaperPosition,
  type SimFacts,
  type TrendSignal,
  CHECK_PLAN,
} from "@/domain/industryTrend/paper";
import type { Bar, CostModel } from "@/domain/backtest/types";
import { runTimeMachine } from "@/domain/timemachine/tmRunner";
import type { TmInput, TmResult } from "@/domain/timemachine/types";
import { buildRecord } from "@/domain/timemachine/record";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { inputOf, barsOf } from "@/views/timemachine/model";
import { historySourceOf } from "@/views/timemachine/historySources";
import { simulations } from "@/views/timemachine/simulations";
import type { SimulationStore } from "@/views/timemachine/simStore";
import type { TimeMachineCandle } from "@/views/timemachine/types";

const BOOK_KEY = storageKey("branchen-paper");

/** Costs of a paper fill in an ETF: no fee, 2 bp slippage, no funding – an assumption, shown with the check. */
export const PAPER_COSTS: CostModel = { fees: { exchange: "Papier", makerBps: 0, takerBps: 0 }, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "none" } };

export type CheckStep = "kerzen" | "zeitmaschine" | "regel";

export interface CheckRun {
  status: "running" | "done" | "error";
  step: CheckStep | null;
  /** 0 … 1 inside the Zeitmaschine step */
  progress: number;
  decision: Decision | null;
  plan: CheckPlan | null;
  simulationId: string | null;
  /** German reason when `error` */
  message: string | null;
  /** source label and fetch time of the candles, as shown */
  source: string | null;
}

export type OpenResult = "opened" | "duplicate" | "refused" | "nocheck";

export interface PaperDeps {
  now(): number;
  loadBars(symbol: string, signal: AbortSignal): Promise<{ ok: true; candles: TimeMachineCandle[]; fetchedAt: number; sourceLabel: string } | { ok: false; message: string }>;
  runSim(input: TmInput, signal: AbortSignal, onProgress: (p: number) => void): Promise<TmResult>;
  sims(): SimulationStore;
}

const defaultDeps: PaperDeps = {
  now: () => Date.now(),
  async loadBars(symbol, signal) {
    const h = historySourceOf("stocks");
    const r = await h.load({ symbol, interval: "1d", signal, until: Date.now() });
    return r.ok ? { ok: true, candles: r.candles, fetchedAt: r.fetchedAt, sourceLabel: r.sourceLabel } : { ok: false, message: r.message };
  },
  runSim: (input, signal, onProgress) => runTimeMachine(input, { signal, onProgress: (p) => onProgress(p) }),
  sims: () => simulations(),
};
let deps: PaperDeps = defaultDeps;

/** Tests: other candles / simulation / clock / store (`null` restores the real ones). */
export function setPaperDepsForTests(d: Partial<PaperDeps> | null): void {
  deps = { ...defaultDeps, ...(d ?? {}) };
}

/** What a finished check keeps so that opening needs no second fetch (memory only). */
interface CheckData {
  bars: Bar[];
  plan: CheckPlan | null;
  sim: SimFacts | null;
  simulationId: string | null;
}
const data = new Map<string, CheckData>();
const controllers = new Map<string, AbortController>();

export interface PaperState {
  book: PaperBook;
  checks: Record<string, CheckRun>;
  /** the last thing that happened, in words (a status line under the buttons) */
  note: string | null;

  setKillSwitch(on: boolean): void;
  /** candles → Zeitmaschine → rules for one signal (nothing opens) */
  check(signal: TrendSignal): Promise<void>;
  /** opens the position of a checked signal – once; a second call returns `duplicate` */
  openFrom(signal: TrendSignal): OpenResult;
  /** closes a position at the instrument's last close (fetched now); `false` + a note when there is no price */
  close(id: string, reason: "rot" | "manuell", exitSignalId?: string): Promise<boolean>;
  cancel(signalId: string): void;
  clearNote(): void;
}

function save(book: PaperBook): void {
  writeJson(BOOK_KEY, { ...book, positions: book.positions.slice(-MAX_POSITIONS) });
}

const emptyRun = (over: Partial<CheckRun> = {}): CheckRun => ({ status: "running", step: "kerzen", progress: 0, decision: null, plan: null, simulationId: null, message: null, source: null, ...over });

export const usePaper = create<PaperState>((set, get) => ({
  book: bookOfStored(readJson<unknown>(BOOK_KEY, null)),
  checks: {},
  note: null,

  setKillSwitch(on) {
    const book = { ...get().book, killSwitch: on };
    save(book);
    // the checks on screen were made under the other setting: they have to be run again
    set({ book, checks: {}, note: on ? "Not-Aus an: es wird keine neue Position eröffnet." : "Not-Aus aus." });
    data.clear();
  },

  async check(signal) {
    const id = signal.signalId;
    controllers.get(id)?.abort();
    const ctl = new AbortController();
    controllers.set(id, ctl);
    const put = (r: Partial<CheckRun>): void => {
      if (controllers.get(id) !== ctl) return;
      set((s) => ({ checks: { ...s.checks, [id]: { ...(s.checks[id] ?? emptyRun()), ...r } } }));
    };
    set((s) => ({ note: null, checks: { ...s.checks, [id]: emptyRun() } }));
    const now = deps.now();
    const instrument = instrumentOf(signal.branche);
    const base = { signal, now, book: get().book, instrument };

    // 1. the rules that need no data: if one of them already says no, nothing is fetched and nothing is simulated
    const pre = decide({ ...base, bars: null, barsProblem: "Noch nicht geladen.", plan: null, sim: null });
    const early = pre.checks.filter((c) => ["notaus", "gruen", "alter", "instrument", "doppel", "offen"].includes(c.id) && !c.ok);
    if (early.length || !instrument) {
      data.set(id, { bars: [], plan: null, sim: null, simulationId: null });
      put({ status: "done", step: null, decision: { ok: false, checks: pre.checks.map((c) => (["kerzen", "zeitmaschine", "limit", "groesse"].includes(c.id) ? { ...c, text: "Nicht geprüft – eine frühere Regel hat schon Nein gesagt." } : c)), sizing: null } });
      return;
    }

    try {
      // 2. the candles of the instrument
      put({ step: "kerzen" });
      const loaded = await deps.loadBars(instrument.symbol, ctl.signal);
      if (ctl.signal.aborted) return;
      if (!loaded.ok) {
        data.set(id, { bars: [], plan: null, sim: null, simulationId: null });
        put({ status: "done", step: null, decision: decide({ ...base, bars: null, barsProblem: loaded.message, plan: null, sim: null }) });
        return;
      }
      const bars = barsOf(loaded.candles);
      const plan = planFromBars(bars);
      const source = `${loaded.sourceLabel}`;
      put({ plan, source });

      // 3. the Zeitmaschine plays the plan through (only when the data are fresh enough to act on)
      let sim: SimFacts | null = null;
      let simulationId: string | null = null;
      const preData = decide({ ...base, bars, plan, sim: null });
      const dataOk = preData.checks.find((c) => c.id === "kerzen")?.ok === true && plan != null;
      if (dataOk && plan) {
        put({ step: "zeitmaschine", progress: 0 });
        const prepared = inputOf({
          symbol: instrument.symbol,
          side: "long",
          entry: plan.entry,
          stop: plan.stop,
          target: plan.target,
          candles: loaded.candles,
          interval: "1d",
          costs: PAPER_COSTS,
          options: { horizon: CHECK_PLAN.horizon },
        });
        if (!prepared.ok) throw new Error(prepared.why);
        const result = await deps.runSim(prepared.input, ctl.signal, (p) => put({ progress: p }));
        if (ctl.signal.aborted) return;
        const record = buildRecord(prepared.input, result, { tradeId: positionIdOf(id), source, fetchedAt: loaded.fetchedAt });
        await deps.sims().save(record);
        simulationId = record.simulationId;
        const m = record.metrics;
        sim = { simulationId, tradeId: record.tradeId, symbol: record.symbol, runs: m.runs, verdictId: m.verdictId, verdict: m.verdict, targetP: m.targetP, stopP: m.stopP, expectancyR: m.expectancyR, plan: record.plan };
      }

      // 4. the risk rule on everything
      put({ step: "regel" });
      data.set(id, { bars, plan, sim, simulationId });
      const final = decide({ ...base, book: get().book, bars, plan, sim });
      // without fresh candles nothing was simulated: say that, not "not played through yet"
      const decision: Decision = dataOk ? final : { ...final, checks: final.checks.map((c) => (c.id === "zeitmaschine" ? { ...c, text: "Nicht geprüft – ohne frische Kerzen wird nicht simuliert." } : c)) };
      put({ status: "done", step: null, progress: 1, simulationId, decision });
    } catch (e) {
      if (ctl.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      put({ status: "error", step: null, message: e instanceof Error ? e.message : "Die Prüfung ist fehlgeschlagen." });
    } finally {
      if (controllers.get(id) === ctl) controllers.delete(id);
    }
  },

  openFrom(signal) {
    const d = data.get(signal.signalId);
    const run = get().checks[signal.signalId];
    if (!d || !run || run.status !== "done") return "nocheck";
    const instrument = instrumentOf(signal.branche);
    // the rule is applied again to the book as it is now (a second click, another tab)
    const out = openPosition({ signal, now: deps.now(), book: get().book, instrument, bars: d.bars.length ? d.bars : null, plan: d.plan, sim: d.sim, simulationId: d.simulationId ?? "" });
    if (out.status === "opened") {
      save(out.book);
      set({ book: out.book, note: `Papier-Position eröffnet: ${out.position.qty} × ${out.position.symbol} zu ${out.position.entry.toLocaleString("de-DE")} $ (nichts gesendet).` });
      return "opened";
    }
    if (out.status === "duplicate") {
      set({ note: "Dieses Signal hat schon eine Position – es wurde keine zweite eröffnet." });
      return "duplicate";
    }
    set((s) => ({ note: "Nicht eröffnet: die Regeln sagen Nein.", checks: { ...s.checks, [signal.signalId]: { ...run, decision: out.decision } } }));
    return "refused";
  },

  async close(id, reason, exitSignalId) {
    const p = get().book.positions.find((x) => x.id === id && x.status === "open");
    if (!p) return false;
    const ctl = new AbortController();
    const loaded = await deps.loadBars(p.symbol, ctl.signal).catch((): { ok: false; message: string } => ({ ok: false, message: "Die Kerzen konnten nicht geladen werden." }));
    if (!loaded.ok) {
      set({ note: `Nicht geschlossen: kein Kurs für ${p.symbol} (${loaded.message})` });
      return false;
    }
    const bars = barsOf(loaded.candles);
    const last = bars[bars.length - 1];
    if (!last) {
      set({ note: `Nicht geschlossen: keine Kerze für ${p.symbol}.` });
      return false;
    }
    const out = closePosition(get().book, id, last.c, reason, deps.now(), exitSignalId);
    if (!out) return false;
    save(out.book);
    set({ book: out.book, note: `Papier-Position geschlossen: ${out.position.symbol} zu ${out.position.exit?.toLocaleString("de-DE")} $ (letzter Schlusskurs; nichts gesendet).` });
    return true;
  },

  cancel(signalId) {
    controllers.get(signalId)?.abort();
    controllers.delete(signalId);
    set((s) => {
      const { [signalId]: _drop, ...rest } = s.checks;
      void _drop;
      return { checks: rest };
    });
  },

  clearNote() {
    set({ note: null });
  },
}));

/** The store's clock (ms) – the same one the checks use. */
export const paperNow = (): number => deps.now();

/** The open position a red signal calls for closing (or `null`). */
export const redTarget = (signal: TrendSignal): PaperPosition | null => positionForRed(usePaper.getState().book, signal);

/** Tests: back to the first state (storage is read again, running checks are dropped). */
export function resetPaperForTests(): void {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  data.clear();
  usePaper.setState({ book: bookOfStored(readJson<unknown>(BOOK_KEY, null)), checks: {}, note: null });
}

export { emptyBook };
