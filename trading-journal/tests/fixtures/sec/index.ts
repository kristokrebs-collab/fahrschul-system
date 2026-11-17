/**
 * The SEC fixtures (see `make.mjs`: rebuilt in SEC's real formats, AAPL checked against TradingView and the real run of the
 * trader-analyst skill, NWIN synthetic) and helpers that turn them into what the functions and the app handle.
 */
import { pickFilings, archiveFolder, exhibitName, namesOfIndex, factsUrl, submissionsUrl, TICKERS_URL } from "../../../src/market/sec/filings";
import { reduceCompanyFacts } from "../../../src/market/sec/reduce";
import { SEC_SOURCE, type SecEarnings8k, type SecFactsPayload, type SecFilingsPayload } from "../../../src/market/sec/wire";
import aaplFacts from "./companyfacts-0000320193.json";
import nwinFacts from "./companyfacts-0000999001.json";
import aaplSubmissions from "./submissions-0000320193.json";
import nwinSubmissions from "./submissions-0000999001.json";
import aaplEightKIndex from "./index-0000320193-00-900106.json";
import tickers from "./company_tickers.json";

export const COMPANY_TICKERS: unknown = tickers;
export const FIXTURES = {
  AAPL: { cik: "0000320193", facts: aaplFacts as unknown, submissions: aaplSubmissions as unknown },
  NWIN: { cik: "0000999001", facts: nwinFacts as unknown, submissions: nwinSubmissions as unknown },
} as const;
export const AAPL_8K_INDEX: unknown = aaplEightKIndex;
export type FixtureTicker = keyof typeof FIXTURES;

export const FETCHED_AT = Date.UTC(2026, 9, 25, 12, 0, 0);

/** `GET /api/v1/sec/facts` as the function builds it (the reducer applied to the fixture). */
export function factsPayload(ticker: FixtureTicker, extra: Partial<SecFactsPayload> = {}): SecFactsPayload {
  const f = FIXTURES[ticker];
  const r = reduceCompanyFacts(f.facts);
  return { source: SEC_SOURCE, ticker, cik: f.cik, entity: r.entity, sourceUrl: factsUrl(f.cik), fetchedAt: FETCHED_AT, asOf: r.asOf, cached: false, facts: r.facts, ...extra };
}

/** `GET /api/v1/sec/filings` as the function builds it. */
export function filingsPayload(ticker: FixtureTicker, extra: Partial<SecFilingsPayload> = {}): SecFilingsPayload {
  const f = FIXTURES[ticker];
  const p = pickFilings(f.submissions, f.cik);
  let earnings8k: SecEarnings8k | null = null;
  if (p.earnings8k) {
    const name = ticker === "AAPL" ? exhibitName(namesOfIndex(AAPL_8K_INDEX), p.earnings8k.url.split("/").pop()) : null;
    earnings8k = { ...p.earnings8k, exhibitUrl: name ? archiveFolder(f.cik, p.earnings8k.accession) + name : null };
  }
  const name = ticker === "AAPL" ? "Apple Inc." : "Northwind Industrial Corp.";
  return { source: SEC_SOURCE, ticker, cik: f.cik, entity: name, sourceUrl: submissionsUrl(f.cik), fetchedAt: FETCHED_AT, cached: false, filings: p.filings, report: p.report, earnings8k, earningsHistory: p.earningsHistory, ...extra };
}

export { TICKERS_URL };
