/**
 * House Clerk access for the Congress tracker. Server only: the browser cannot read the Clerk (no CORS) and a PDF is turned into
 * rows here, so only names, a year and document numbers go out and plain rows come back.
 *
 * - **Public data, nothing personal.** The two upstream files are the yearly index ZIP and one PTR PDF; the requests carry no
 *   cookie, no account value and no user data. The User-Agent names the app and what it does.
 * - **Politeness.** Every upstream request first takes a slot of the account-wide window (`rate_hit`, 40 per 10 s) and times out
 *   after 7 s; a PTR is fetched once and kept (it never changes once posted – an amendment is a new document number).
 * - **Cache.** In memory per function instance: the index 15 min (the Clerk rebuilds it about once a day), a read report 6 h.
 *   When the Clerk cannot be read and an older index (≤ 7 days) exists, that copy is served marked `stale` with its original read
 *   time – the app says so; nothing is invented.
 * - **Reading.** The index XML → `src/market/congress/clerk.ts`; a PDF → `pdf.ts` (text runs) → `src/market/congress/ptr.ts`
 *   (rows). What cannot be read cleanly is an unreadable row or an unreadable report with its reason, never a guess.
 * - **Typed errors** (`error.code`): `congress_no_index` 404, `congress_busy` 429, `congress_timeout` 504, `congress_upstream` 502,
 *   `congress_format` 502 (the Clerk's index changed its shape), `invalid_query` 400. A single report that cannot be fetched is
 *   reported on its own entry (`not-found | timeout | upstream | busy`), the others still come back.
 */
import { ClerkFormatError, indexUrl, parseIndexXml, ptrUrl } from "../../../../src/market/congress/clerk";
import { parsePtr } from "../../../../src/market/congress/ptr";
import {
  CONGRESS_LIMITS,
  CONGRESS_SOURCE,
  DOC_ID,
  type CongressIndexPayload,
  type CongressPtrPayload,
  type CongressPtrResult,
  type CongressReport,
  type ReportProblem,
} from "../../../../src/market/congress/wire";
import { HttpError } from "../http";
import { rateKey, rateLimit } from "../rateLimit";
import { memoryLimit } from "../stocks/guard";
import { PdfError, readPdfText } from "./pdf";
import { readZipEntry, ZipError } from "./zip";

export const CLERK_USER_AGENT = "trading-journal-congress/1.0 (reads the public STOCK Act index and Periodic Transaction Reports; no personal data)";
const TIMEOUT_MS = 7_000;
const GLOBAL_MAX = 40;
const GLOBAL_WINDOW_SEC = 10;
const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 6 * 1024 * 1024;

export const INDEX_TTL_MS = 15 * 60_000;
export const INDEX_STALE_MS = 7 * 24 * 3_600_000;
export const REPORT_TTL_MS = 6 * 3_600_000;
const MAX_REPORTS = 120;

let fetchOverride: typeof fetch | null = null;
const indexCache = new Map<number, { at: number; payload: CongressIndexPayload }>();
const indexInflight = new Map<number, Promise<{ at: number; payload: CongressIndexPayload }>>();
const reportCache = new Map<string, { at: number; report: CongressReport }>();
const reportInflight = new Map<string, Promise<CongressPtrResult>>();

/** Tests: inject `fetch` and start from a clean cache (`null` restores the real one). */
export function setCongressForTests(opts: { fetch?: typeof fetch | null } | null): void {
  fetchOverride = opts?.fetch ?? null;
  indexCache.clear();
  indexInflight.clear();
  reportCache.clear();
  reportInflight.clear();
}

/* --------------------------------------------------------------------------------------------- upstream */

class Upstream extends Error {
  constructor(
    readonly kind: "not-found" | "timeout" | "upstream" | "busy",
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "Upstream";
  }
}

/** A slot of the account-wide window (all instances share `rate_hit`); without the database the per-instance counter stands in. */
async function takeSlot(): Promise<boolean> {
  const key = rateKey("congress-upstream");
  try {
    return (await rateLimit(key, GLOBAL_MAX, GLOBAL_WINDOW_SEC)).ok;
  } catch {
    try {
      memoryLimit(key, GLOBAL_MAX, GLOBAL_WINDOW_SEC);
      return true;
    } catch {
      return false;
    }
  }
}

async function clerkGet(url: string, maxBytes: number): Promise<{ bytes: Buffer; modified: number | null }> {
  if (!(await takeSlot())) throw new Upstream("busy", "Der Server ruft gerade viele Meldungen ab. Bitte gleich noch einmal versuchen.");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await (fetchOverride ?? fetch)(url, { headers: { "user-agent": CLERK_USER_AGENT, accept: "*/*" }, signal: ctl.signal, redirect: "follow" });
    if (res.status === 404) throw new Upstream("not-found", "Beim House Clerk gibt es zu dieser Nummer kein Dokument.", 404);
    if (res.status === 429) throw new Upstream("busy", "Der House Clerk bremst gerade (HTTP 429).", 429);
    if (!res.ok) throw new Upstream("upstream", `Der House Clerk antwortete mit einem Fehler (HTTP ${res.status}).`, res.status);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Upstream("upstream", "Die Datei des House Clerk ist ungewöhnlich groß und wird nicht gelesen.", res.status);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > maxBytes) throw new Upstream("upstream", "Die Datei des House Clerk ist ungewöhnlich groß und wird nicht gelesen.", res.status);
    const lm = Date.parse(res.headers.get("last-modified") ?? "");
    return { bytes, modified: Number.isFinite(lm) ? lm : null };
  } catch (e) {
    if (e instanceof Upstream) throw e;
    if (ctl.signal.aborted || (e instanceof Error && e.name === "AbortError")) throw new Upstream("timeout", "Der House Clerk antwortet nicht rechtzeitig.");
    console.error("[fn] congress network", e instanceof Error ? e.name : typeof e);
    throw new Upstream("upstream", "Der House Clerk ist gerade nicht erreichbar.");
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------------------------------ index */

export function parseYear(raw: string | null, now: number = Date.now()): number {
  const y = Number(raw);
  const max = new Date(now).getUTCFullYear() + 1;
  if (!/^\d{4}$/.test(raw ?? "") || y < CONGRESS_LIMITS.firstYear || y > max) throw new HttpError(400, "invalid_query", `Das Jahr muss zwischen ${CONGRESS_LIMITS.firstYear} und ${max} liegen.`);
  return y;
}

async function readIndex(year: number): Promise<{ at: number; payload: CongressIndexPayload }> {
  let got: Awaited<ReturnType<typeof clerkGet>>;
  try {
    got = await clerkGet(indexUrl(year), MAX_INDEX_BYTES);
  } catch (e) {
    if (e instanceof Upstream) {
      if (e.kind === "not-found") throw new HttpError(404, "congress_no_index", `Für ${year} liegt beim House Clerk noch kein Index vor.`);
      if (e.kind === "busy") throw new HttpError(429, "congress_busy", e.message, undefined, { "retry-after": "30" });
      if (e.kind === "timeout") throw new HttpError(504, "congress_timeout", "Der House Clerk antwortet nicht rechtzeitig. Bitte gleich noch einmal versuchen.");
      throw new HttpError(502, "congress_upstream", e.message);
    }
    throw e;
  }
  try {
    const entry = readZipEntry(got.bytes, /\.xml$/i);
    const parsed = parseIndexXml(entry.data.toString("utf8"), year);
    const at = Date.now();
    return {
      at,
      payload: {
        source: CONGRESS_SOURCE,
        year,
        fetchedAt: at,
        fileTime: got.modified ?? entry.time,
        cached: false,
        sourceUrl: indexUrl(year),
        counts: { all: parsed.total, ptr: parsed.filings.length },
        filings: parsed.filings,
      },
    };
  } catch (e) {
    if (e instanceof ZipError || e instanceof ClerkFormatError) {
      console.error("[fn] congress index format", e.name);
      throw new HttpError(502, "congress_format", `Der Index des House Clerk für ${year} lässt sich nicht lesen (${e.message}). Der Aufbau der Datei hat sich vermutlich geändert.`);
    }
    throw e;
  }
}

const retryable = (e: unknown): boolean => e instanceof HttpError && (e.status >= 500 || e.code === "congress_busy");

/** The PTR index of a year: cached 15 min, an older copy (≤ 7 days) when the Clerk cannot be read. */
export async function loadIndex(year: number): Promise<CongressIndexPayload> {
  const now = Date.now();
  const hit = indexCache.get(year);
  if (hit && now - hit.at < INDEX_TTL_MS) return { ...hit.payload, cached: true };
  let p = indexInflight.get(year);
  const mine = !p;
  if (!p) {
    p = readIndex(year);
    indexInflight.set(year, p);
  }
  try {
    const e = await p;
    if (mine) indexCache.set(year, e);
    return mine ? e.payload : { ...e.payload, cached: true };
  } catch (err) {
    if (hit && retryable(err) && now - hit.at < INDEX_STALE_MS) return { ...hit.payload, cached: true, stale: true };
    throw err;
  } finally {
    if (mine) indexInflight.delete(year);
  }
}

/* ----------------------------------------------------------------------------------------------- reports */

const PROBLEM_TEXT: Readonly<Record<ReportProblem, string>> = {
  scan: "Diese Meldung ist ein eingescanntes Papierformular (Bilder, kein Text) und wird nicht automatisch gelesen.",
  format: "Der Aufbau dieser PDF-Datei ist unbekannt – vermutlich hat der House Clerk das Formular oder das Dateiformat geändert. Die Zeilen werden nicht geraten.",
  encrypted: "Diese PDF-Datei ist passwortgeschützt und wird nicht gelesen.",
  mismatch: "Die Datei trägt eine andere Dokumentnummer als die angefragte und wird nicht übernommen.",
};

function unreadableReport(docId: string, year: number, readAt: number, problem: ReportProblem, message?: string, head: { filer?: string | null; signed?: string | null } = {}): CongressReport {
  return { docId, year, url: ptrUrl(year, docId), readAt, status: "unreadable", problem, message: message ?? PROBLEM_TEXT[problem], filer: head.filer ?? null, signed: head.signed ?? null, rows: [] };
}

/** A fetched PDF → report. Never throws for a file it does not understand. */
export function reportOfPdf(docId: string, year: number, bytes: Uint8Array, readAt: number): CongressReport {
  try {
    const p = parsePtr(readPdfText(bytes));
    const head = { filer: p.filer, signed: p.signed };
    if (p.problem) return unreadableReport(docId, year, readAt, p.problem, p.message, head);
    if (p.filingId && p.filingId !== docId) return unreadableReport(docId, year, readAt, "mismatch", undefined, head);
    return { docId, year, url: ptrUrl(year, docId), readAt, status: "ok", filer: p.filer, signed: p.signed, rows: p.rows };
  } catch (e) {
    if (e instanceof PdfError) {
      const problem: ReportProblem = e.kind === "scan" ? "scan" : e.kind === "encrypted" ? "encrypted" : "format";
      return unreadableReport(docId, year, readAt, problem);
    }
    console.error("[fn] congress parse", e instanceof Error ? e.name : typeof e);
    return unreadableReport(docId, year, readAt, "format");
  }
}

async function readReport(docId: string, year: number): Promise<CongressPtrResult> {
  try {
    const got = await clerkGet(ptrUrl(year, docId), MAX_PDF_BYTES);
    return { ok: true, report: reportOfPdf(docId, year, got.bytes, Date.now()) };
  } catch (e) {
    if (e instanceof Upstream) return { ok: false, reason: e.kind, message: e.message };
    throw e;
  }
}

/** One report: from memory, else fetched and read (concurrent callers share one request). Failures are not remembered. */
export async function loadReport(docId: string, year: number): Promise<CongressPtrResult> {
  const key = `${year}:${docId}`;
  const hit = reportCache.get(key);
  if (hit && Date.now() - hit.at < REPORT_TTL_MS) return { ok: true, report: hit.report };
  let p = reportInflight.get(key);
  const mine = !p;
  if (!p) {
    p = readReport(docId, year);
    reportInflight.set(key, p);
  }
  try {
    const r = await p;
    if (mine && r.ok) {
      reportCache.set(key, { at: r.report.readAt, report: r.report });
      while (reportCache.size > MAX_REPORTS) reportCache.delete(reportCache.keys().next().value as string);
    }
    return r;
  } finally {
    if (mine) reportInflight.delete(key);
  }
}

export function parseDocs(raw: string | null): string[] {
  const list = [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (!list.length) throw new HttpError(400, "invalid_query", "Es fehlt mindestens eine Dokumentnummer (docs=20035143).");
  if (list.length > CONGRESS_LIMITS.docsPerRequest) throw new HttpError(400, "invalid_query", `Pro Abruf sind höchstens ${CONGRESS_LIMITS.docsPerRequest} Dokumente erlaubt.`);
  const bad = list.filter((d) => !DOC_ID.test(d));
  if (bad.length) throw new HttpError(400, "invalid_query", `Keine gültige Dokumentnummer: ${bad.slice(0, 3).join(", ")}.`);
  return list;
}

/** `GET /congress/ptr`: the reports of up to four documents, each with its own outcome. */
export async function loadReports(year: number, docs: readonly string[]): Promise<CongressPtrPayload> {
  const entries = await Promise.all(docs.map(async (d): Promise<[string, CongressPtrResult]> => [d, await loadReport(d, year)]));
  return { source: CONGRESS_SOURCE, year, fetchedAt: Date.now(), results: Object.fromEntries(entries) };
}
