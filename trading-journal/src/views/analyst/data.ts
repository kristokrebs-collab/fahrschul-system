/**
 * Loading the SEC numbers for the analyst views: facts and filings in parallel, then the deterministic analysis. A failure of the
 * filings list does not hide the numbers (the earnings-8-K link and the "newer report" hint are simply missing, and the card says
 * so); a failure of the facts is the error of the whole load.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { analyse, type AnalystResult } from "@/domain/analyst";
import { fetchSecFacts, fetchSecFilings, SecError, toSecError, type SecStamped, type SecFactsPayload, type SecFilingsPayload } from "@/market/sec";

export interface Analysis {
  ticker: string;
  result: AnalystResult;
  facts: SecStamped<SecFactsPayload>;
  filings: SecStamped<SecFilingsPayload> | null;
  filingsError: SecError | null;
}

export interface LoadOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  fresh?: boolean;
  /** epoch ms "now" for the "old numbers" hint (tests) */
  now?: number;
}

export async function loadAnalysis(ticker: string, opts: LoadOptions = {}): Promise<Analysis> {
  const o = { ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.fresh ? { fresh: true } : {}) };
  const [facts, filings] = await Promise.allSettled([fetchSecFacts(ticker, o), fetchSecFilings(ticker, o)]);
  if (facts.status === "rejected") throw toSecError(facts.reason);
  let list: SecStamped<SecFilingsPayload> | null = null;
  let filingsError: SecError | null = null;
  if (filings.status === "fulfilled") list = filings.value;
  else {
    const e = toSecError(filings.reason);
    if (e instanceof SecError) filingsError = e;
    else throw e;
  }
  const result = analyse(facts.value.data, { ...(list ? { filings: list.data } : {}), ...(opts.now != null ? { now: opts.now } : {}) });
  return { ticker: facts.value.data.ticker || ticker.toUpperCase(), result, facts: facts.value, filings: list, filingsError };
}

export type AnalysisState =
  | { status: "idle" }
  | { status: "loading"; ticker: string }
  | { status: "ready"; ticker: string; analysis: Analysis }
  | { status: "error"; ticker: string; error: SecError };

/** The load as a small state machine; a new load cancels the running one, leaving the view cancels it too. */
export function useAnalysis(fetchImpl?: typeof fetch, now?: () => number): { state: AnalysisState; load: (ticker: string, fresh?: boolean) => Promise<Analysis | null> } {
  const [state, setState] = useState<AnalysisState>({ status: "idle" });
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const load = useCallback(
    async (ticker: string, fresh?: boolean): Promise<Analysis | null> => {
      ctl.current?.abort();
      const mine = new AbortController();
      ctl.current = mine;
      setState({ status: "loading", ticker });
      try {
        const analysis = await loadAnalysis(ticker, { signal: mine.signal, ...(fetchImpl ? { fetchImpl } : {}), ...(fresh ? { fresh } : {}), ...(now ? { now: now() } : {}) });
        if (ctl.current !== mine) return null;
        setState({ status: "ready", ticker: analysis.ticker, analysis });
        return analysis;
      } catch (e) {
        if (ctl.current !== mine || (e instanceof DOMException && e.name === "AbortError")) return null;
        setState({ status: "error", ticker, error: e instanceof SecError ? e : (toSecError(e) as SecError) });
        return null;
      }
    },
    [fetchImpl, now],
  );
  return { state, load };
}
