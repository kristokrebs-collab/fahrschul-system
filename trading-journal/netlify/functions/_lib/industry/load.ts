/**
 * Ken French's 48 industry portfolios (daily) for the Branchen-Trend module. Server only: the library has no CORS headers and the
 * file is a 4 MB ZIP with a 21 MB CSV, so it is unpacked here (Node `zlib`, no dependency) and sent small (see `src/market/industry/wire.ts`).
 *
 * - **Public data, nothing personal.** One GET of a fixed URL; the request carries no cookie, no account value and no user data. The
 *   User-Agent names the app and what it does. No secret is involved.
 * - **Timeout and size.** The download is cut off after 8 s (the platform ends a function at about 10 s) and refused above 12 MB.
 * - **Cache.** In memory per function instance for 6 hours (the library is updated about once a month); concurrent callers share one
 *   download. When the library cannot be read and an older copy (≤ 90 days) exists, that copy is served marked `stale` with its
 *   original read time – the app says so; nothing is invented.
 * - **Reading.** Only the first table ("Average Value Weighted Returns -- Daily"), only rows that start with an 8-digit day and have as
 *   many numbers as names. Anything else (a new header, a different count, a value out of range, days out of order) is a typed
 *   `industry_format` error: the shape changed, the numbers are not guessed.
 * - **Typed errors** (`error.code`): `industry_timeout` 504, `industry_upstream` 502, `industry_format` 502, `rate_limited` 429.
 */
import { gzipSync } from "node:zlib";
import {
  INDUSTRY_COUNT,
  INDUSTRY_ENCODING,
  INDUSTRY_LIMITS,
  INDUSTRY_MISSING,
  INDUSTRY_SOURCE,
  INDUSTRY_ZIP_URL,
  type IndustryDailyPayload,
} from "../../../../src/market/industry/wire";
import { HttpError } from "../http";
import { readZipEntry, ZipError } from "../congress/zip";

export const INDUSTRY_USER_AGENT = "trading-journal-industry/1.0 (reads the public Ken French data library file for industry trend signals; no personal data)";
const TIMEOUT_MS = 8_000;
const MAX_ZIP_BYTES = 12 * 1024 * 1024;
export const INDUSTRY_TTL_MS = 6 * 3_600_000;
export const INDUSTRY_STALE_MS = 90 * 24 * 3_600_000;

let fetchOverride: typeof fetch | null = null;
let cache: { at: number; payload: IndustryDailyPayload } | null = null;
let inflight: Promise<{ at: number; payload: IndustryDailyPayload }> | null = null;

/** Tests: inject `fetch` and start from a clean cache (`null` restores the real one). */
export function setIndustryForTests(opts: { fetch?: typeof fetch | null } | null): void {
  fetchOverride = opts?.fetch ?? null;
  cache = null;
  inflight = null;
}

export class IndustryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndustryFormatError";
  }
}

export interface ParsedIndustries {
  names: string[];
  dates: Int32Array;
  /** industry-major, hundredths of a percent, `INDUSTRY_MISSING` where the library has no value */
  returns: Int16Array;
  database: string | null;
}

const TABLE_HEAD = /Average Value Weighted Returns\s*--\s*Daily/i;

/** The first (value-weighted) table of the CSV. Throws `IndustryFormatError` for anything it does not recognise. */
export function parseIndustryCsv(text: string): ParsedIndustries {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => TABLE_HEAD.test(l));
  if (start < 0) throw new IndustryFormatError("Die Tabelle „Average Value Weighted Returns -- Daily“ fehlt.");
  const head = lines[start + 1] ?? "";
  if (!head.startsWith(",")) throw new IndustryFormatError("Die Kopfzeile mit den Branchennamen fehlt.");
  const names = head.split(",").slice(1).map((s) => s.trim());
  if (names.length !== INDUSTRY_COUNT || names.some((n) => !/^[A-Za-z0-9]{1,12}$/.test(n)) || new Set(names).size !== names.length)
    throw new IndustryFormatError(`Erwartet werden ${INDUSTRY_COUNT} Branchen mit einfachen Kürzeln, gefunden: ${names.length}.`);
  const N = names.length;
  const dates: number[] = [];
  const rows: Int16Array[] = [];
  for (let i = start + 2; i < lines.length; i++) {
    const l = lines[i]!;
    if (!/^\d{8},/.test(l)) {
      if (dates.length) break;
      if (l.trim() === "") continue;
      throw new IndustryFormatError("Nach der Kopfzeile folgen keine Tageswerte.");
    }
    const parts = l.split(",");
    if (parts.length !== N + 1) throw new IndustryFormatError(`Zeile ${parts[0]}: ${parts.length - 1} statt ${N} Werte.`);
    const day = Number(parts[0]);
    if (dates.length && day <= dates[dates.length - 1]!) throw new IndustryFormatError(`Die Tage sind nicht aufsteigend (${parts[0]}).`);
    const row = new Int16Array(N);
    for (let k = 0; k < N; k++) {
      const v = Number(parts[k + 1]);
      if (!Number.isFinite(v)) throw new IndustryFormatError(`Zeile ${parts[0]}: „${parts[k + 1]!.trim()}“ ist keine Zahl.`);
      if (v <= -99) row[k] = INDUSTRY_MISSING;
      else {
        const bp = Math.round(v * 100);
        if (bp > 32_000 || bp < -32_000) throw new IndustryFormatError(`Zeile ${parts[0]}: der Wert ${v} liegt außerhalb des gelesenen Bereichs.`);
        row[k] = bp;
      }
    }
    dates.push(day);
    rows.push(row);
  }
  const T = dates.length;
  if (T < INDUSTRY_LIMITS.minDays || T > INDUSTRY_LIMITS.maxDays) throw new IndustryFormatError(`Ungewöhnlich viele oder wenige Tage: ${T}.`);
  const returns = new Int16Array(N * T);
  for (let t = 0; t < T; t++) {
    const row = rows[t]!;
    for (let k = 0; k < N; k++) returns[k * T + t] = row[k]!;
  }
  const db = /created using the (\d{6}) CRSP database/i.exec(lines.slice(0, start).join("\n"));
  return { names, dates: Int32Array.from(dates), returns, database: db ? db[1]! : null };
}

/** The wire block: dates then returns (both little endian), gzip, base64. */
export function packIndustries(p: ParsedIndustries): { data: string; bytes: number } {
  const T = p.dates.length;
  const buf = Buffer.alloc(T * 4 + p.returns.length * 2);
  for (let t = 0; t < T; t++) buf.writeInt32LE(p.dates[t]!, t * 4);
  for (let k = 0; k < p.returns.length; k++) buf.writeInt16LE(p.returns[k]!, T * 4 + k * 2);
  return { data: gzipSync(buf, { level: 9 }).toString("base64"), bytes: buf.length };
}

class Upstream extends Error {
  constructor(
    readonly kind: "timeout" | "upstream",
    message: string,
  ) {
    super(message);
    this.name = "Upstream";
  }
}

async function download(): Promise<{ bytes: Buffer; modified: number | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await (fetchOverride ?? fetch)(INDUSTRY_ZIP_URL, { headers: { "user-agent": INDUSTRY_USER_AGENT, accept: "application/zip,*/*" }, signal: ctl.signal, redirect: "follow" });
    if (!res.ok) throw new Upstream("upstream", `Die Ken-French-Datenbibliothek antwortete mit einem Fehler (HTTP ${res.status}).`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_ZIP_BYTES) throw new Upstream("upstream", "Die Datei der Datenbibliothek ist ungewöhnlich groß und wird nicht gelesen.");
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_ZIP_BYTES) throw new Upstream("upstream", "Die Datei der Datenbibliothek ist ungewöhnlich groß und wird nicht gelesen.");
    const lm = Date.parse(res.headers.get("last-modified") ?? "");
    return { bytes, modified: Number.isFinite(lm) ? lm : null };
  } catch (e) {
    if (e instanceof Upstream) throw e;
    if (ctl.signal.aborted || (e instanceof Error && e.name === "AbortError")) throw new Upstream("timeout", "Die Ken-French-Datenbibliothek antwortet nicht rechtzeitig.");
    console.error("[fn] industry network", e instanceof Error ? e.name : typeof e);
    throw new Upstream("upstream", "Die Ken-French-Datenbibliothek ist gerade nicht erreichbar.");
  } finally {
    clearTimeout(timer);
  }
}

async function read(): Promise<{ at: number; payload: IndustryDailyPayload }> {
  let got: Awaited<ReturnType<typeof download>>;
  try {
    got = await download();
  } catch (e) {
    if (e instanceof Upstream) {
      if (e.kind === "timeout") throw new HttpError(504, "industry_timeout", `${e.message} Bitte gleich noch einmal versuchen.`);
      throw new HttpError(502, "industry_upstream", e.message);
    }
    throw e;
  }
  try {
    const entry = readZipEntry(got.bytes, /\.csv$/i);
    const parsed = parseIndustryCsv(entry.data.toString("latin1"));
    const packed = packIndustries(parsed);
    const at = Date.now();
    const T = parsed.dates.length;
    return {
      at,
      payload: {
        source: INDUSTRY_SOURCE,
        fetchedAt: at,
        fileTime: got.modified,
        cached: false,
        database: parsed.database,
        names: parsed.names,
        days: T,
        firstDay: parsed.dates[0]!,
        lastDay: parsed.dates[T - 1]!,
        encoding: INDUSTRY_ENCODING,
        bytes: packed.bytes,
        data: packed.data,
      },
    };
  } catch (e) {
    if (e instanceof ZipError || e instanceof IndustryFormatError) {
      console.error("[fn] industry format", e.name);
      throw new HttpError(502, "industry_format", `Die Datei der Ken-French-Bibliothek lässt sich nicht lesen (${e.message}). Der Aufbau hat sich vermutlich geändert; es werden keine Zahlen geraten.`);
    }
    throw e;
  }
}

const retryable = (e: unknown): boolean => e instanceof HttpError && e.status >= 500;

/** The packed industries: from memory (6 h), else downloaded and read; an older copy (≤ 90 days) when the library cannot be read. */
export async function loadIndustries(): Promise<IndustryDailyPayload> {
  const now = Date.now();
  const hit = cache;
  if (hit && now - hit.at < INDUSTRY_TTL_MS) return { ...hit.payload, cached: true };
  let p = inflight;
  const mine = !p;
  if (!p) {
    p = read();
    inflight = p;
  }
  try {
    const e = await p;
    if (mine) cache = e;
    return mine ? e.payload : { ...e.payload, cached: true };
  } catch (err) {
    if (hit && retryable(err) && now - hit.at < INDUSTRY_STALE_MS) return { ...hit.payload, cached: true, stale: true };
    throw err;
  } finally {
    if (mine) inflight = null;
  }
}
