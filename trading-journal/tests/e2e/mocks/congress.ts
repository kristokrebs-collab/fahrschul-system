/**
 * The Congress functions for the browser specs: `/api/v1/congress/index` and `/api/v1/congress/ptr` answered from `page.route`.
 * The reports are REAL: the fixture PDFs of the House Clerk (`tests/fixtures/congress`) as the server's own reader made rows of
 * them (`reports.json`; `tests/unit/congress.parse.test.ts` keeps that file equal to the reader's output – the Playwright project
 * cannot import server code), so the rows in the browser are the rows of real filings. Only the DATES are moved: no spec may depend on the
 * day it runs on (no clock jumps), so every filing is dated relative to "today" and its trades a fixed number of days before the
 * filing – the delay on screen is the same on every run.
 */
import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import type { CongressFiling, CongressIndexPayload, CongressPtrPayload, CongressPtrResult, CongressReport, CongressRow } from "../../../src/market/congress/wire";

const REPORTS = JSON.parse(readFileSync(new URL("../../fixtures/congress/reports.json", import.meta.url), "utf8")) as Record<string, CongressReport>;
const DAY = 86_400_000;
const JSON_HEADERS = { "content-type": "application/json" };

export interface WorldFiling {
  docId: string;
  name: string;
  last: string;
  district: string;
  /** the filing day as days before today (the browser's day) */
  daysAgo: number;
  /** the fixture PDF read for it (`reports.json`); `scan` = a paper filing the reader cannot read; `missing` = the Clerk has no such file */
  source: "20035143" | "20035408" | "20034694" | "20035024" | "9000001" | "missing";
  /** trades are moved to this many days before the filing (a fixed delay on screen) */
  lagDays?: number;
}

const iso = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const shiftDay = (day: string, days: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export const WORLD: readonly WorldFiling[] = [
  { docId: "20035143", name: "Nancy Pelosi", last: "Pelosi", district: "CA11", daysAgo: 3, source: "20035143", lagDays: 28 },
  { docId: "20035408", name: "April McClain Delaney", last: "Delaney", district: "MD06", daysAgo: 8, source: "20035408", lagDays: 12 },
  { docId: "20035024", name: "Daniel Crenshaw", last: "Crenshaw", district: "TX02", daysAgo: 12, source: "20035024", lagDays: 60 },
  { docId: "20034694", name: "Laurel Lee", last: "Lee", district: "FL15", daysAgo: 15, source: "20034694", lagDays: 30 },
  { docId: "9000001", name: "Sam Scanner", last: "Scanner", district: "NY01", daysAgo: 5, source: "9000001" },
];

export interface Congress {
  /** every request that reached a function, in order */
  calls: string[];
  /** answer the next requests with this failure instead (a Clerk that is down) */
  failIndex: { status: number; code: string; message: string } | null;
  /** `docId`s the "server" cannot fetch from the Clerk */
  busy: Set<string>;
}

function filingOf(f: WorldFiling, now: number): CongressFiling {
  const filed = iso(now - f.daysAgo * DAY);
  return { docId: f.docId, year: Number(filed.slice(0, 4)), name: f.name, last: f.last, district: f.district, filed, url: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${filed.slice(0, 4)}/${f.docId}.pdf` };
}

function resultOf(f: WorldFiling, now: number): CongressPtrResult {
  const filing = filingOf(f, now);
  if (f.source === "missing") return { ok: false, reason: "not-found", message: "Beim House Clerk gibt es zu dieser Nummer kein Dokument." };
  const report = REPORTS[f.source]!;
  const traded = shiftDay(filing.filed!, -(f.lagDays ?? 20));
  const rows: CongressRow[] = report.rows.map((r) => (r.ok ? { ...r, tradeDate: traded, notifiedDate: traded } : r));
  return { ok: true, report: { ...report, docId: f.docId, year: filing.year, url: filing.url, readAt: now, rows, signed: filing.filed } };
}

/** Routes both functions. `world` is the list of filings the "Clerk" holds. */
export async function mockCongress(page: Page, world: readonly WorldFiling[] = WORLD): Promise<Congress> {
  const state: Congress = { calls: [], failIndex: null, busy: new Set() };
  const now = Date.now();
  await page.route(/\/api\/v1\/congress\/index/, async (route: Route) => {
    const year = Number(new URL(route.request().url()).searchParams.get("year"));
    state.calls.push(`index:${year}`);
    if (state.failIndex) return route.fulfill({ status: state.failIndex.status, headers: JSON_HEADERS, body: JSON.stringify({ error: { code: state.failIndex.code, message: state.failIndex.message } }) });
    const filings = world
      .map((f) => filingOf(f, now))
      .filter((f) => f.year === year)
      .sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? ""));
    const body: CongressIndexPayload = {
      source: "house-clerk",
      year,
      fetchedAt: now,
      fileTime: now - 6 * 3_600_000,
      cached: false,
      sourceUrl: `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`,
      counts: { all: filings.length + 40, ptr: filings.length },
      filings,
    };
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(body) });
  });
  await page.route(/\/api\/v1\/congress\/ptr/, async (route: Route) => {
    const u = new URL(route.request().url());
    const docs = (u.searchParams.get("docs") ?? "").split(",").filter(Boolean);
    state.calls.push(`ptr:${docs.join(",")}`);
    const results: Record<string, CongressPtrResult> = {};
    for (const d of docs) {
      const f = world.find((w) => w.docId === d);
      results[d] = state.busy.has(d) ? { ok: false, reason: "timeout", message: "Der House Clerk antwortet nicht rechtzeitig." } : f ? resultOf(f, now) : { ok: false, reason: "not-found", message: "Beim House Clerk gibt es zu dieser Nummer kein Dokument." };
    }
    const body: CongressPtrPayload = { source: "house-clerk", year: Number(u.searchParams.get("year")), fetchedAt: now, results };
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(body) });
  });
  return state;
}
