/**
 * Wire contract of `/api/v1/sec/facts` and `/api/v1/sec/filings` (SEC EDGAR through the Netlify functions).
 *
 * PURE and alias-free: the functions (`netlify/functions/sec-*.mts`) import this file by RELATIVE path, the app imports it as
 * `@/market/sec`. Nothing here touches the network or the DOM.
 *
 * What the server sends is a REDUCED copy of SEC's "company facts" (only the concepts the analyst reads, only recent years,
 * one unit per concept – `reduce.ts`), never the 3 – 20 MB original. Every number in it is a number the company tagged in a
 * 10-Q / 10-K; the server computes nothing. The arithmetic (single quarters from cumulative values, growth, margins) lives
 * in `src/domain/analyst` and is deterministic.
 */

/** Name of the source in `source` fields (the UI label is `SEC_SOURCE_LABEL`). */
export const SEC_SOURCE = "sec-edgar" as const;
export const SEC_SOURCE_LABEL = "SEC EDGAR (XBRL)";

/** One tagged value of a filing ("fact"). `start` is absent for instants (balance sheet). Dates are `YYYY-MM-DD`. */
export interface FactRow {
  start?: string;
  end: string;
  val: number;
  /** fiscal year / period the FILING says it belongs to (`FY`, `Q1`…`Q3`) – of the filing, not of the fact: a later filing repeats earlier periods as comparatives */
  fy?: number | null;
  fp?: string | null;
  form: string;
  filed: string;
  accn: string;
}

/** All rows of one concept in one unit (`USD`, `USD/shares`, `shares`, or another currency). */
export interface FactSeries {
  unit: string;
  rows: FactRow[];
}

/** Concept key: `us-gaap:Revenues`, `dei:EntityCommonStockSharesOutstanding`. */
export type ConceptKey = string;

/** `GET /api/v1/sec/facts?ticker=…` */
export interface SecFactsPayload {
  source: typeof SEC_SOURCE;
  ticker: string;
  /** 10 digits */
  cik: string;
  entity: string;
  /** the SEC document the numbers come from */
  sourceUrl: string;
  /** ms epoch when the SERVER read SEC (a cached answer keeps its original time) */
  fetchedAt: number;
  /** newest period end among the kept facts, `YYYY-MM-DD`; `null` when there are none */
  asOf: string | null;
  /** served from the server's memory instead of a fresh SEC read */
  cached: boolean;
  /** SEC could not be read just now and this is the last good copy (see `fetchedAt`) */
  stale?: boolean;
  facts: Record<ConceptKey, FactSeries>;
}

/** One filing of the list (10-Q, 10-K, 8-K and their amendments). */
export interface SecFiling {
  form: string;
  /** filing date `YYYY-MM-DD` */
  filed: string;
  /** period of the report (`reportDate`), `null` for events without one */
  reportDate: string | null;
  accession: string;
  /** 8-K items (`2.02`, `9.01` …); empty for reports */
  items: string[];
  /** the main document */
  url: string;
  /** the folder's index page (all documents of the filing) */
  indexUrl: string;
}

/** The newest earnings 8-K (item 2.02) with the link to its press release (exhibit 99), when one was found. */
export interface SecEarnings8k extends SecFiling {
  exhibitUrl: string | null;
}

/** `GET /api/v1/sec/filings?ticker=…` */
export interface SecFilingsPayload {
  source: typeof SEC_SOURCE;
  ticker: string;
  cik: string;
  entity: string;
  sourceUrl: string;
  fetchedAt: number;
  cached: boolean;
  stale?: boolean;
  /** the newest filings of the forms 10-Q, 10-K, 8-K (and /A), newest first, at most 10 */
  filings: SecFiling[];
  /** newest 10-Q / 10-K */
  report: SecFiling | null;
  /** newest 8-K with item 2.02 – its press release is looked up (one extra SEC read) */
  earnings8k: SecEarnings8k | null;
  /** recent 8-Ks with item 2.02 (newest first, at most 8; no press-release lookup) – to match a report to its quarter */
  earningsHistory: SecFiling[];
}

/** Typed error codes of the SEC functions (`error.code` of the shared envelope). */
export const SEC_ERROR_CODES = [
  "sec_setup_required", // SEC_USER_AGENT missing: no SEC call was made
  "sec_unknown_ticker", // not in company_tickers.json
  "sec_no_facts", // SEC has no XBRL facts for this CIK (fund, foreign filer …)
  "sec_busy", // SEC rate limit / block
  "sec_timeout",
  "sec_upstream", // SEC answered with an error
  "sec_invalid", // SEC answered with something that is not the expected JSON
] as const;
export type SecErrorCode = (typeof SEC_ERROR_CODES)[number];
