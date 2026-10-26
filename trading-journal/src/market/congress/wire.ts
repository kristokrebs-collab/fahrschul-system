/**
 * Wire contract of `/api/v1/congress/index` and `/api/v1/congress/ptr` (the House Clerk's public financial disclosures through the
 * Netlify functions) and the plain data model of a Periodic Transaction Report (PTR) row.
 *
 * PURE and alias-free: the functions (`netlify/functions/congress-*.mts`) import this file by RELATIVE path, the app as
 * `@/market/congress`. Nothing here touches the network or the DOM.
 *
 * What these data are, in one place (the UI says it too): members of the House must report stock trades of their own, their
 * spouse's and their dependent children's under the STOCK Act – within 30 days of learning of the trade and at most 45 days after
 * it. So a row is a PUBLIC disclosure that is days or weeks old; amounts are RANGES the filing states, never prices; the member is
 * not necessarily the one who decided (a spouse, a manager); and nothing in a filing is a signal.
 */

/** Name of the source in `source` fields (the UI label is `CONGRESS_SOURCE_LABEL`). */
export const CONGRESS_SOURCE = "house-clerk" as const;
export const CONGRESS_SOURCE_LABEL = "House Clerk (disclosures-clerk.house.gov)";
/** Where the reports are published – the link of "Quelle". */
export const CONGRESS_SOURCE_URL = "https://disclosures-clerk.house.gov/FinancialDisclosure";
/** The Senate has no automatic route (its search asks for an agreement the person has to accept). */
export const SENATE_SEARCH_URL = "https://efdsearch.senate.gov/search/";

/** Days after a trade at which a report is late (STOCK Act: within 30 days of notice, at the latest 45 days after the trade). */
export const LATE_AFTER_DAYS = 45;

/** One filing of the Clerk's yearly index (only Periodic Transaction Reports are sent). */
export interface CongressFiling {
  /** the Clerk's document number (digits) */
  docId: string;
  /** the index year the filing is listed in (also the folder of its PDF) */
  year: number;
  /** "Nancy Pelosi" – first and last name as the index writes them (suffix after the name) */
  name: string;
  /** last name alone, for sorting */
  last: string;
  /** `CA11` */
  district: string;
  /** the filing date `YYYY-MM-DD`; `null` when the index has none */
  filed: string | null;
  /** the PDF on the Clerk's site */
  url: string;
}

/** `GET /api/v1/congress/index?year=…` */
export interface CongressIndexPayload {
  source: typeof CONGRESS_SOURCE;
  year: number;
  /** ms epoch when the SERVER read the index (a cached answer keeps its original time) */
  fetchedAt: number;
  /** the time stamp of the file inside the ZIP (ms epoch, from the ZIP entry), `null` when unreadable */
  fileTime: number | null;
  cached: boolean;
  /** the Clerk could not be read just now and this is the last good copy (see `fetchedAt`) */
  stale?: boolean;
  /** the index document the list comes from */
  sourceUrl: string;
  /** how many filings the index holds in total (all types) and how many of them are PTRs */
  counts: { all: number; ptr: number };
  /** Periodic Transaction Reports, newest filing first */
  filings: CongressFiling[];
}

export type CongressOwner = "self" | "spouse" | "joint" | "child";
export type CongressSide = "buy" | "sell" | "sell-partial" | "exchange";

export interface CongressOption {
  contracts: number | null;
  /** `null` = the description did not say call or put */
  kind: "call" | "put" | null;
  /** strike price in dollars; `null` = the description did not give a readable one */
  strike: number | null;
  /** `YYYY-MM-DD`; `null` = not readable */
  expires: string | null;
  /** the description starts with "Exercised" */
  exercised: boolean;
}

/** A row that was read cleanly. */
export interface CongressTrade {
  ok: true;
  owner: CongressOwner;
  /** the asset's name without ticker and type code ("Bloom Energy Corporation Class A Common Stock") */
  asset: string;
  /** the ticker the filing prints in parentheses, `null` = the row has none (a private LLC, real estate …) */
  ticker: string | null;
  /** the House's two-letter asset type code in brackets ("ST" stock, "OP" option …), `null` = none printed */
  assetCode: string | null;
  side: CongressSide;
  /** `YYYY-MM-DD` */
  tradeDate: string;
  /** `YYYY-MM-DD`, the "notification date" column; `null` = not readable */
  notifiedDate: string | null;
  /** the range exactly as printed ("$1,000,001 - $5,000,000") */
  amountText: string;
  /** lower bound of the range in dollars, `null` = not a range the reader knows */
  amountLow: number | null;
  /** upper bound in dollars, `null` = open ended ("Over $50,000,000") or not known */
  amountHigh: number | null;
  option: CongressOption | null;
  /** shares named in the description ("Purchased 10,000 shares.") */
  shares: number | null;
  /** the description of the row as printed */
  description: string | null;
  /** "Subholding of": the account the trade sits in, as printed */
  account: string | null;
}

/** A row the reader could not read cleanly – shown as "nicht lesbar" with the link to the PDF, never guessed. */
export interface CongressUnreadableRow {
  ok: false;
  /** German sentence: what exactly could not be read */
  reason: string;
  /** the text of the row as extracted (short, for the reader to see what is there) */
  raw: string;
}

export type CongressRow = CongressTrade | CongressUnreadableRow;

/** Why a whole report could not be turned into rows. */
export type ReportProblem =
  /** a scanned paper filing: an image, no text */
  | "scan"
  /** the PDF has a layout or structure the reader does not know (the Clerk changed its form or generator) */
  | "format"
  /** the PDF is protected with a password */
  | "encrypted"
  /** the PDF carries another filing number than the one asked for */
  | "mismatch";

export interface CongressReport {
  docId: string;
  year: number;
  /** the PDF on the Clerk's site */
  url: string;
  /** the time the filing was read from the Clerk (ms epoch) */
  readAt: number;
  /** `ok`: rows were read (they can still contain unreadable ones); `unreadable`: the report as a whole could not be read */
  status: "ok" | "unreadable";
  problem?: ReportProblem;
  /** German sentence for an unreadable report */
  message?: string;
  /** the filer as the PDF prints it ("Hon. Nancy Pelosi"), `null` when not read */
  filer: string | null;
  /** the date of the signature in the PDF (`YYYY-MM-DD`), `null` when not read */
  signed: string | null;
  rows: CongressRow[];
}

export type CongressPtrFailure =
  /** the Clerk does not have a document with this number in this year */
  | "not-found"
  | "timeout"
  | "upstream"
  /** the server is busy with other requests – try again */
  | "busy";

export type CongressPtrResult = { ok: true; report: CongressReport } | { ok: false; reason: CongressPtrFailure; message: string };

/** `GET /api/v1/congress/ptr?year=…&docs=…` */
export interface CongressPtrPayload {
  source: typeof CONGRESS_SOURCE;
  year: number;
  /** ms epoch of the answer */
  fetchedAt: number;
  results: Record<string, CongressPtrResult>;
}

/* ------------------------------------------------------------------------------------------------ limits */

export const CONGRESS_LIMITS = {
  /** reports per `ptr` request */
  docsPerRequest: 4,
  /** first index year that exists as a yearly ZIP with PTRs (the STOCK Act is from 2012) */
  firstYear: 2013,
} as const;

export const DOC_ID = /^\d{6,9}$/;

/* ------------------------------------------------------------------------------------------------ guards */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Every link the app shows points to the Clerk – a payload with another link is refused as a whole. */
const CLERK_LINK = /^https:\/\/disclosures-clerk\.house\.gov\//;

export function filingOk(f: unknown): f is CongressFiling {
  return isObj(f) && typeof f.docId === "string" && DOC_ID.test(f.docId) && typeof f.year === "number" && typeof f.name === "string" && typeof f.last === "string" && typeof f.district === "string" && (f.filed === null || isDay(f.filed)) && typeof f.url === "string" && CLERK_LINK.test(f.url);
}

export function indexPayloadOk(v: unknown): v is CongressIndexPayload {
  return isObj(v) && v.source === CONGRESS_SOURCE && typeof v.year === "number" && typeof v.fetchedAt === "number" && typeof v.sourceUrl === "string" && CLERK_LINK.test(v.sourceUrl) && isObj(v.counts) && Array.isArray(v.filings) && v.filings.every(filingOk);
}

function rowOk(r: unknown): r is CongressRow {
  if (!isObj(r)) return false;
  if (r.ok === false) return typeof r.reason === "string" && typeof r.raw === "string";
  return (
    r.ok === true &&
    ["self", "spouse", "joint", "child"].includes(r.owner as string) &&
    typeof r.asset === "string" &&
    (r.ticker === null || typeof r.ticker === "string") &&
    ["buy", "sell", "sell-partial", "exchange"].includes(r.side as string) &&
    isDay(r.tradeDate) &&
    typeof r.amountText === "string" &&
    (r.option === null || isObj(r.option))
  );
}

export function reportOk(v: unknown): v is CongressReport {
  return isObj(v) && typeof v.docId === "string" && DOC_ID.test(v.docId) && typeof v.url === "string" && CLERK_LINK.test(v.url) && typeof v.readAt === "number" && (v.status === "ok" || v.status === "unreadable") && Array.isArray(v.rows) && v.rows.every(rowOk);
}

export function ptrPayloadOk(v: unknown): v is CongressPtrPayload {
  if (!(isObj(v) && v.source === CONGRESS_SOURCE && typeof v.fetchedAt === "number" && isObj(v.results))) return false;
  return Object.values(v.results).every((r) => isObj(r) && (r.ok === true ? reportOk(r.report) : r.ok === false && typeof r.reason === "string" && typeof r.message === "string"));
}
