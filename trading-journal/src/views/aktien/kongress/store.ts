/**
 * What the Congress card holds while it is open (memory only): the Clerk's index per year, the reports read so far (each a typed
 * result with its stamp), and the progress of the reading. A new load cancels the one that is going, and a late answer of an
 * older load never overwrites a newer one. The network is `@/market/congress` (cache first, typed failures); this store only
 * decides WHICH reports to read (`selectFilings`: window + member, newest first, capped) and keeps the answers.
 */
import { create } from "zustand";
import { selectFilings, windowYears, type WindowId } from "@/domain/congress";
import { congressData, type CongressData } from "@/market/congress/client";
import type { CongressResult } from "@/market/congress/result";
import type { CongressFiling, CongressIndexPayload, CongressReport } from "@/market/congress/wire";

/** Reports one load reads at most; "weitere lesen" raises it by this much. */
export const READ_STEP = 80;

export interface LoadRequest {
  /** today as `YYYY-MM-DD` */
  today: string;
  window: WindowId;
  /** words of a member's name: only that member's reports are read */
  member: string;
  /** reports to read at most */
  cap: number;
  /** ask the sources again even if the cache is fresh */
  fresh?: boolean;
}

export interface Reading {
  /** reports to read in this load */
  total: number;
  /** answered so far (read, cached or failed) */
  done: number;
  /** more reports match than the cap allows */
  capped: boolean;
  /** how many match window and member in all */
  matching: number;
}

export interface CongressState {
  /** the Clerk's index per year */
  indexes: Record<number, CongressResult<CongressIndexPayload>>;
  /** merged PTR filings of the years loaded (newest first) */
  filings: CongressFiling[];
  /** the report of a document number */
  reports: Record<string, CongressResult<CongressReport>>;
  reading: Reading | null;
  /** the request the state belongs to; `null` = nothing loaded yet */
  request: LoadRequest | null;
  /** an index load is going */
  loadingIndex: boolean;
  load(req: LoadRequest, data?: CongressData): Promise<void>;
  abort(): void;
}

let controller: AbortController | null = null;
let seq = 0;

const mergeFilings = (indexes: Record<number, CongressResult<CongressIndexPayload>>): CongressFiling[] => {
  const out: CongressFiling[] = [];
  for (const r of Object.values(indexes)) if (r.status !== "unavailable") out.push(...r.data.filings);
  return out.sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? "") || b.docId.localeCompare(a.docId));
};

export const useCongress = create<CongressState>((set) => ({
  indexes: {},
  filings: [],
  reports: {},
  reading: null,
  request: null,
  loadingIndex: false,
  abort: () => {
    controller?.abort();
  },
  load: async (req, data = congressData()) => {
    controller?.abort();
    const ctrl = new AbortController();
    controller = ctrl;
    const my = ++seq;
    const current = (): boolean => my === seq && !ctrl.signal.aborted;
    set({ request: req, loadingIndex: true, reading: null });

    const years = windowYears(req.window, req.today);
    const indexes: Record<number, CongressResult<CongressIndexPayload>> = {};
    await Promise.all(
      years.map(async (y) => {
        const r = await data.index(y, { signal: ctrl.signal, ...(req.fresh ? { fresh: true } : {}) });
        if (!current()) return;
        indexes[y] = r;
        set({ indexes: { ...indexes }, filings: mergeFilings(indexes) });
      }),
    );
    if (!current()) return;
    set({ loadingIndex: false });
    const filings = mergeFilings(indexes);
    const pick = selectFilings(filings, { window: req.window, today: req.today, member: req.member, cap: req.cap });
    set({ reading: { total: pick.filings.length, done: 0, capped: pick.capped, matching: pick.total } });
    if (!pick.filings.length) return;

    const byYear = new Map<number, string[]>();
    for (const f of pick.filings) byYear.set(f.year, [...(byYear.get(f.year) ?? []), f.docId]);
    let done = 0;
    let pending: Record<string, CongressResult<CongressReport>> = {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    // answers arrive one by one (cache hits all at once): the store is updated in steps, not per report
    const flush = (): void => {
      timer = null;
      if (!current()) return;
      const batch = pending;
      pending = {};
      set((s) => ({ reports: { ...s.reports, ...batch }, reading: s.reading ? { ...s.reading, done } : s.reading }));
    };
    for (const [year, ids] of byYear) {
      await data.reports(year, ids, {
        signal: ctrl.signal,
        ...(req.fresh ? { fresh: true } : {}),
        onResult: (docId, result) => {
          if (!current()) return;
          done++;
          pending[docId] = result;
          if (!timer) timer = setTimeout(flush, 60);
        },
      });
    }
    if (timer) clearTimeout(timer);
    flush();
    // the final count even when the last flush was skipped
    if (current()) set((s) => ({ reading: s.reading ? { ...s.reading, done: s.reading.total } : s.reading }));
  },
}));

/** Tests: forget everything this store holds. */
export function resetCongressForTests(): void {
  seq++;
  controller?.abort();
  controller = null;
  useCongress.setState({ indexes: {}, filings: [], reports: {}, reading: null, request: null, loadingIndex: false });
}
