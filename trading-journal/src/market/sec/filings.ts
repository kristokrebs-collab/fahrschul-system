/**
 * The filings list of a company (`data.sec.gov/submissions/CIK##########.json`) → the newest 10-Q / 10-K / 8-K, the newest
 * earnings 8-K (item 2.02, "Results of Operations") and the way to its press release (exhibit 99). Pure and alias-free.
 */
import { isIsoDate } from "./days";
import type { SecFiling } from "./wire";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** Forms the list shows. */
export const LIST_FORMS: ReadonlySet<string> = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A", "10-KT", "8-K", "8-K/A"]);
/** Forms that count as "the newest report". */
export const REPORT_ONLY: ReadonlySet<string> = new Set(["10-Q", "10-K", "10-KT", "20-F", "40-F"]);

export const MAX_FILINGS = 10;
export const MAX_EARNINGS_HISTORY = 8;

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;

/** `https://www.sec.gov/Archives/edgar/data/<cik>/<accession without dashes>/` */
export function archiveFolder(cik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/`;
}

/** Folder listing as JSON (used once, to find the press release). */
export const archiveIndexJson = (cik: string, accession: string): string => `${archiveFolder(cik, accession)}index.json`;

/** The company's filing index page on sec.gov (a link for people). */
export const companyBrowseUrl = (cik: string): string => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`;

export const factsUrl = (cik: string): string => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
export const submissionsUrl = (cik: string): string => `https://data.sec.gov/submissions/CIK${cik}.json`;
export const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

const col = (rec: Raw, name: string): unknown[] => (Array.isArray(rec[name]) ? (rec[name] as unknown[]) : []);

/** All 10-Q / 10-K / 8-K rows of the `recent` block, newest first. Rows with an unreadable date, accession or file name are skipped. */
export function filingRows(submissions: unknown, cik: string): SecFiling[] {
  const rec = isObj(submissions) && isObj(submissions.filings) && isObj(submissions.filings.recent) ? submissions.filings.recent : {};
  const forms = col(rec, "form");
  const acc = col(rec, "accessionNumber");
  const filed = col(rec, "filingDate");
  const report = col(rec, "reportDate");
  const doc = col(rec, "primaryDocument");
  const items = col(rec, "items");
  const out: SecFiling[] = [];
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    const a = acc[i];
    const f = filed[i];
    if (typeof form !== "string" || !LIST_FORMS.has(form) || typeof a !== "string" || !ACCESSION.test(a) || !isIsoDate(f)) continue;
    const folder = archiveFolder(cik, a);
    const d = doc[i];
    const r = report[i];
    const it = items[i];
    out.push({
      form,
      filed: f,
      reportDate: isIsoDate(r) ? r : null,
      accession: a,
      items: typeof it === "string" && it ? it.split(",").map((s) => s.trim()).filter(Boolean) : [],
      url: typeof d === "string" && SAFE_NAME.test(d) ? folder + d : `${folder}${a}-index.htm`,
      indexUrl: `${folder}${a}-index.htm`,
    });
  }
  return out.sort((x, y) => y.filed.localeCompare(x.filed) || y.accession.localeCompare(x.accession));
}

export const isEarnings8k = (f: SecFiling): boolean => f.form === "8-K" && f.items.includes("2.02");

export interface PickedFilings {
  filings: SecFiling[];
  report: SecFiling | null;
  earnings8k: SecFiling | null;
  earningsHistory: SecFiling[];
}

/** The list for the app: the newest ten, the newest report, the newest earnings 8-K and the recent earnings 8-Ks. */
export function pickFilings(submissions: unknown, cik: string): PickedFilings {
  const rows = filingRows(submissions, cik);
  const history = rows.filter(isEarnings8k);
  return {
    filings: rows.slice(0, MAX_FILINGS),
    report: rows.find((f) => REPORT_ONLY.has(f.form)) ?? null,
    earnings8k: history[0] ?? null,
    earningsHistory: history.slice(0, MAX_EARNINGS_HISTORY),
  };
}

/** Patterns for the press release among a filing's files, best first (the usual names of exhibit 99.1). */
const EXHIBIT_RANK: readonly RegExp[] = [/ex(?:hibit)?[-_]?99[-_.]?0?1(?!\d)/i, /ex(?:hibit)?[-_]?99/i, /earnings|release|press/i, /ex(?:hibit)?[-_]?\d/i];

/** The press release among the files of an 8-K folder (`index.json` → `directory.item[].name`), or `null`. */
export function exhibitName(names: readonly string[], primary?: string): string | null {
  const docs = names.filter((n) => SAFE_NAME.test(n) && /\.(htm|html|txt|pdf)$/i.test(n) && n !== primary && !/^(R\d+\.htm|\d{10}-\d{2}-\d{6})/i.test(n));
  for (const rx of EXHIBIT_RANK) {
    const hit = docs.filter((n) => rx.test(n)).sort()[0];
    if (hit) return hit;
  }
  return null;
}

/** File names of an EDGAR `index.json` folder listing. */
export function namesOfIndex(json: unknown): string[] {
  const dir = isObj(json) && isObj(json.directory) ? json.directory : {};
  const items = Array.isArray(dir.item) ? dir.item : [];
  return items.map((x) => (isObj(x) && typeof x.name === "string" ? x.name : "")).filter(Boolean);
}
