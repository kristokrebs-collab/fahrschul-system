/**
 * The tracker's list: filings + the reports read so far → one line per transaction row (or one "nicht lesbar" line for a report
 * that could not be read as a whole), with the delay, the watchlist mark and the "new since your last visit" mark; and the
 * filters of the card. Pure and deterministic – the same input gives the same list, nothing here fetches or stores.
 */
import type { CongressFiling, CongressReport, CongressRow } from "@/market/congress/wire";
import { delayInfo, type DelayInfo } from "./delay";
import { isWatched, tickerKey } from "./watch";
import { memberMatches, plain } from "./window";

export interface TradeLine {
  /** stable: `docId:index`, `docId:report` for an unreadable report */
  key: string;
  docId: string;
  index: number;
  filing: CongressFiling;
  /** the day the report was filed (the Clerk's index, else the signature in the PDF) */
  filed: string | null;
  row: CongressRow;
  /** `null` for a row that could not be read */
  delay: DelayInfo | null;
  /** the ticker is on the watchlist */
  watched: boolean;
  /** the report was not in the index at your last visit */
  isNew: boolean;
}

export interface BuildInput {
  filings: readonly CongressFiling[];
  reports: Readonly<Record<string, CongressReport | undefined>>;
  watch: ReadonlySet<string>;
  fresh: ReadonlySet<string>;
}

/** One line per row of every report that was read, newest filing first, the rows of a report in the order of the form. */
export function buildLines(input: BuildInput): TradeLine[] {
  const out: TradeLine[] = [];
  const sorted = [...input.filings].sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? "") || b.docId.localeCompare(a.docId));
  for (const filing of sorted) {
    const report = input.reports[filing.docId];
    if (!report) continue;
    const filed = filing.filed ?? report.signed;
    const isNew = input.fresh.has(filing.docId);
    if (report.status === "unreadable") {
      out.push({ key: `${filing.docId}:report`, docId: filing.docId, index: -1, filing, filed, row: { ok: false, reason: report.message ?? "Die Meldung lässt sich nicht lesen.", raw: "" }, delay: null, watched: false, isNew });
      continue;
    }
    report.rows.forEach((row, index) => {
      out.push({
        key: `${filing.docId}:${index}`,
        docId: filing.docId,
        index,
        filing,
        filed,
        row,
        delay: row.ok ? delayInfo(row.tradeDate, filed) : null,
        watched: row.ok && isWatched(row.ticker, input.watch),
        isNew,
      });
    });
  }
  return out;
}

export type SideFilter = "all" | "buy" | "sell";

export interface LineFilter {
  /** words of the member's name or district */
  member: string;
  /** a ticker (exact) or a part of the asset's name (3 letters or more) */
  query: string;
  side: SideFilter;
  watchOnly: boolean;
  newOnly: boolean;
  /** only rows that name a ticker */
  tickerOnly: boolean;
}

export const NO_FILTER: LineFilter = { member: "", query: "", side: "all", watchOnly: false, newOnly: false, tickerOnly: false };

export function queryMatches(row: Extract<CongressRow, { ok: true }>, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (row.ticker && tickerKey(row.ticker) === tickerKey(q)) return true;
  return q.length >= 3 && plain(row.asset).includes(plain(q));
}

export interface Filtered {
  lines: TradeLine[];
  /** unreadable rows the filters on the row's content (ticker, side, …) keep out of view – they cannot be matched, so they are counted, not hidden silently */
  hiddenUnreadable: number;
}

export function filterLines(lines: readonly TradeLine[], f: LineFilter): Filtered {
  const out: TradeLine[] = [];
  let hidden = 0;
  const rowFilterOn = f.query.trim() !== "" || f.side !== "all" || f.watchOnly || f.tickerOnly;
  for (const l of lines) {
    if (!memberMatches(l.filing, f.member)) continue;
    if (f.newOnly && !l.isNew) continue;
    const r = l.row;
    if (!r.ok) {
      if (rowFilterOn) hidden++;
      else out.push(l);
      continue;
    }
    if (f.side === "buy" && r.side !== "buy") continue;
    if (f.side === "sell" && r.side !== "sell" && r.side !== "sell-partial") continue;
    if (f.watchOnly && !l.watched) continue;
    if (f.tickerOnly && !r.ticker) continue;
    if (!queryMatches(r, f.query)) continue;
    out.push(l);
  }
  return { lines: out, hiddenUnreadable: hidden };
}

export interface Summary {
  /** reports in the window */
  filings: number;
  /** reports that were read (rows or "nicht lesbar") */
  read: number;
  /** reports that could not be read as a whole */
  unreadableReports: number;
  /** rows read cleanly */
  rows: number;
  /** rows that could not be read cleanly (single rows) */
  unreadableRows: number;
  withTicker: number;
  watched: number;
  /** rows reported more than 45 days after the trade */
  late: number;
}

/** Counts over ALL lines of the window (not the filtered ones): what the tracker has read, said as numbers. */
export function summarize(lines: readonly TradeLine[], filings: number, read: number): Summary {
  let rows = 0;
  let unreadableRows = 0;
  let unreadableReports = 0;
  let withTicker = 0;
  let watched = 0;
  let late = 0;
  for (const l of lines) {
    if (l.index === -1) {
      unreadableReports++;
      continue;
    }
    if (!l.row.ok) {
      unreadableRows++;
      continue;
    }
    rows++;
    if (l.row.ticker) withTicker++;
    if (l.watched) watched++;
    if (l.delay?.late) late++;
  }
  return { filings, read, unreadableReports, rows, unreadableRows, withTicker, watched, late };
}
