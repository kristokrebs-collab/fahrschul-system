/**
 * State of the Branchen-Trend section: the data (from the industry client), the Ampel computed from it (in small steps, so no single
 * task runs long), the loaded lab result, and the paper protocol (kept on this device). Nothing here sends anything anywhere.
 */
import { create } from "zustand";
import {
  AmpelAborted,
  BASE_PARAMS,
  PROTOKOLL_MAX,
  computeAmpel,
  entriesFromEvents,
  entriesOfStored,
  mergeEntries,
  parseJsonl,
  parseMegatest,
  strategyId,
  type AmpelResult,
  type MegatestResult,
  type ProtokollEintrag,
  MAX_RESULT_BYTES,
} from "@/domain/industryTrend";
import { industryData, type IndustryData } from "@/market/industry/client";
import type { IndustryStamp, IndustryReason } from "@/market/industry/result";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { BRANCHEN } from "./strings";

const PREFS_KEY = storageKey("aktien-branchen");
const LOG_KEY = storageKey("aktien-branchen-protokoll");

export type SortKey = "signal" | "wechsel" | "gewicht" | "name";
export const SORT_KEYS: readonly SortKey[] = ["signal", "wechsel", "gewicht", "name"];

export interface Prefs {
  sort: SortKey;
  onlyBuy: boolean;
  autoLog: boolean;
}
export const DEFAULT_PREFS: Prefs = { sort: "signal", onlyBuy: false, autoLog: true };

export function prefsOf(v: unknown): Prefs {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  return {
    sort: SORT_KEYS.includes(o.sort as SortKey) ? (o.sort as SortKey) : DEFAULT_PREFS.sort,
    onlyBuy: typeof o.onlyBuy === "boolean" ? o.onlyBuy : DEFAULT_PREFS.onlyBuy,
    autoLog: typeof o.autoLog === "boolean" ? o.autoLog : DEFAULT_PREFS.autoLog,
  };
}

export type DataPhase = "idle" | "loading" | "computing" | "ready" | "error";

export interface BranchenState {
  phase: DataPhase;
  /** the Ampel of the base rule on the last day of the data */
  ampel: AmpelResult | null;
  stamp: IndustryStamp | null;
  /** set when the shown data is a copy from this device (the reason in words) */
  stale: { reason: IndustryReason; message: string; failedAt: number } | null;
  error: { reason: IndustryReason; message: string } | null;
  prefs: Prefs;
  protocol: ProtokollEintrag[];
  /** entries the last run added (for a polite line under the button) */
  lastAdded: number;
  result: MegatestResult | null;
  resultName: string | null;
  resultError: string | null;

  start(opts?: { fresh?: boolean }): Promise<void>;
  abort(): void;
  setPrefs(p: Partial<Prefs>): void;
  loadResultText(text: string, name: string): boolean;
  setResultError(message: string): void;
  clearResult(): void;
  importProtocol(text: string): { added: number; skipped: number };
  clearProtocol(): void;
}

const pause = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
let ctl: AbortController | null = null;
let run = 0;

export interface BranchenDeps {
  data: () => IndustryData;
  now: () => Date;
}
let deps: BranchenDeps = { data: industryData, now: () => new Date() };
/** Tests: another data client / clock (`null` restores the real ones). */
export function setBranchenDepsForTests(d: Partial<BranchenDeps> | null): void {
  deps = { data: industryData, now: () => new Date(), ...(d ?? {}) };
}

function saveProtocol(list: readonly ProtokollEintrag[]): void {
  writeJson(LOG_KEY, list.slice(-PROTOKOLL_MAX));
}

export const useBranchen = create<BranchenState>((set, get) => ({
  phase: "idle",
  ampel: null,
  stamp: null,
  stale: null,
  error: null,
  prefs: prefsOf(readJson<unknown>(PREFS_KEY, null)),
  protocol: entriesOfStored(readJson<unknown>(LOG_KEY, null)),
  lastAdded: 0,
  result: null,
  resultName: null,
  resultError: null,

  async start(opts = {}) {
    const mine = ++run;
    ctl?.abort();
    ctl = new AbortController();
    const signal = ctl.signal;
    set({ phase: "loading", error: null, lastAdded: 0 });
    const r = await deps.data().load({ signal, ...(opts.fresh ? { fresh: true } : {}) });
    if (mine !== run) return;
    if (r.status === "unavailable") {
      if (r.reason === "aborted") return;
      set({ phase: "error", error: { reason: r.reason, message: r.message }, ampel: get().ampel });
      return;
    }
    const stamp: IndustryStamp = { source: r.source, asOf: r.asOf, database: r.database, fileTime: r.fileTime, receivedAt: r.receivedAt, fetchedAt: r.fetchedAt };
    set({ phase: "computing", stamp, stale: r.status === "stale" ? { reason: r.reason, message: r.message, failedAt: r.failedAt } : null });
    let ampel: AmpelResult;
    try {
      ampel = await computeAmpel(r.data, { yieldEvery: 4, pause, signal });
    } catch (e) {
      if (e instanceof AmpelAborted || mine !== run) return;
      set({ phase: "error", error: { reason: "bad-response", message: e instanceof Error ? e.message : "Die Ampel konnte nicht gerechnet werden." } });
      return;
    }
    if (mine !== run) return;
    set({ ampel, phase: "ready" });
    if (get().prefs.autoLog) {
      const incoming = entriesFromEvents(ampel.events, strategyId(BASE_PARAMS), deps.now());
      const merged = mergeEntries(get().protocol, incoming);
      if (merged.added.length) {
        saveProtocol(merged.list);
        set({ protocol: merged.list, lastAdded: merged.added.length });
      }
    }
  },

  abort() {
    run++;
    ctl?.abort();
    ctl = null;
    if (get().phase === "loading" || get().phase === "computing") set({ phase: get().ampel ? "ready" : "idle" });
  },

  setPrefs(p) {
    const prefs = { ...get().prefs, ...p };
    writeJson(PREFS_KEY, prefs);
    set({ prefs });
    // switching the protocol on writes the changes of the Ampel already on screen
    const a = get().ampel;
    if (p.autoLog && a) {
      const merged = mergeEntries(get().protocol, entriesFromEvents(a.events, strategyId(BASE_PARAMS), deps.now()));
      if (merged.added.length) {
        saveProtocol(merged.list);
        set({ protocol: merged.list, lastAdded: merged.added.length });
      }
    }
  },

  loadResultText(text, name) {
    if (text.length > MAX_RESULT_BYTES) {
      set({ resultError: BRANCHEN.ergebnis.tooBig });
      return false;
    }
    const r = parseMegatest(text);
    if (!r.ok) {
      set({ resultError: r.reason });
      return false;
    }
    set({ result: r.result, resultName: name, resultError: null });
    return true;
  },
  setResultError(message) {
    set({ resultError: message });
  },
  clearResult() {
    set({ result: null, resultName: null, resultError: null });
  },

  importProtocol(text) {
    const { entries, skipped } = parseJsonl(text);
    const merged = mergeEntries(get().protocol, entries);
    if (merged.added.length) {
      saveProtocol(merged.list);
      set({ protocol: merged.list });
    }
    return { added: merged.added.length, skipped };
  },
  clearProtocol() {
    saveProtocol([]);
    set({ protocol: [], lastAdded: 0 });
  },
}));

/** Tests: back to the first state (storage is read again). */
export function resetBranchenForTests(): void {
  run++;
  ctl?.abort();
  ctl = null;
  useBranchen.setState({
    phase: "idle",
    ampel: null,
    stamp: null,
    stale: null,
    error: null,
    prefs: prefsOf(readJson<unknown>(PREFS_KEY, null)),
    protocol: entriesOfStored(readJson<unknown>(LOG_KEY, null)),
    lastAdded: 0,
    result: null,
    resultName: null,
    resultError: null,
  });
}
