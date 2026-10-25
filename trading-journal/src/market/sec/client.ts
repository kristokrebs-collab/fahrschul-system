/**
 * Client of the SEC functions (`/api/v1/sec/facts`, `/api/v1/sec/filings`). The browser never talks to SEC itself (SEC wants a
 * contact in the User-Agent and has no CORS for `data.sec.gov`); the server reads SEC and reduces the answer.
 *
 * Every result is stamped like the market feeds (`Stamped` in `../types`): `source` (who delivered), `asOf` (the date the
 * numbers refer to: the newest period end / the newest filing), `receivedAt` (when the SERVER read SEC – a cached answer keeps
 * its original time, so "Abruf" in the UI is never fresher than the data), plus the SEC document it comes from. Errors are
 * typed (`SecError.kind`) and carry the server's German message, so the UI can say WHY there is no number.
 *
 * Small in-memory cache (5 minutes, identical requests in flight share one call) so the analyst, the DCF and the thesis
 * monitor do not ask twice for the same company.
 */
import { ApiError, apiFetch } from "@/cloud/api";
import { msOfIso } from "./days";
import { normalizeTicker } from "./tickers";
import { SEC_SOURCE, SEC_SOURCE_LABEL, type SecFactsPayload, type SecFilingsPayload } from "./wire";

export type SecErrorKind =
  /** the operator has not set `SEC_USER_AGENT` – "Einrichtung nötig"; no call was made to SEC */
  | "setup_required"
  | "unknown_ticker"
  | "no_facts"
  | "busy"
  | "timeout"
  | "upstream"
  | "invalid"
  | "invalid_query"
  | "plan_required"
  | "unauthenticated"
  | "rate_limited"
  /** no server functions here (offline file, local-only build, network down) */
  | "unavailable";

const KIND_OF_CODE: Readonly<Record<string, SecErrorKind>> = {
  sec_setup_required: "setup_required",
  sec_unknown_ticker: "unknown_ticker",
  sec_no_facts: "no_facts",
  sec_busy: "busy",
  sec_timeout: "timeout",
  sec_upstream: "upstream",
  sec_invalid: "invalid",
  invalid_query: "invalid_query",
  plan_required: "plan_required",
  unauthenticated: "unauthenticated",
  invalid_token: "unauthenticated",
  rate_limited: "rate_limited",
};

export class SecError extends Error {
  readonly kind: SecErrorKind;
  readonly status: number;
  readonly code: string;
  constructor(kind: SecErrorKind, message: string, status = 0, code: string = kind) {
    super(message);
    this.name = "SecError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** Any thrown value → `SecError` (an abort is passed through untouched). */
export function toSecError(e: unknown): unknown {
  if (e instanceof SecError) return e;
  if (e instanceof DOMException && e.name === "AbortError") return e;
  if (e instanceof ApiError) {
    const kind = KIND_OF_CODE[e.code] ?? (e.status === 0 ? "unavailable" : e.status === 401 ? "unauthenticated" : e.status === 402 ? "plan_required" : e.status === 429 ? "rate_limited" : "upstream");
    return new SecError(kind, e.message, e.status, e.code);
  }
  return new SecError("unavailable", "Die SEC-Zahlen konnten nicht geladen werden.");
}

/** A server answer with its stamp. */
export interface SecStamped<T> {
  data: T;
  source: typeof SEC_SOURCE;
  /** "SEC EDGAR (XBRL)" – the name for the card */
  sourceLabel: string;
  /** the SEC document behind it */
  sourceUrl: string;
  /** epoch ms (UTC midnight) of the date the data refers to; `null` = none */
  asOf: number | null;
  /** epoch ms the server read SEC */
  receivedAt: number;
  cached: boolean;
  /** SEC was not reachable and this is the last good copy */
  stale: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function factsOk(v: unknown): v is SecFactsPayload {
  return isObj(v) && v.source === SEC_SOURCE && typeof v.cik === "string" && typeof v.fetchedAt === "number" && isObj(v.facts);
}
function filingsOk(v: unknown): v is SecFilingsPayload {
  return isObj(v) && v.source === SEC_SOURCE && typeof v.cik === "string" && typeof v.fetchedAt === "number" && Array.isArray(v.filings) && Array.isArray(v.earningsHistory);
}

export interface SecFetchOptions {
  signal?: AbortSignal;
  /** injected fetch (tests) */
  fetchImpl?: typeof fetch;
  /** skip the 5-minute cache of this browser */
  fresh?: boolean;
}

const TTL_MS = 5 * 60_000;
const memo = new Map<string, { at: number; value: SecStamped<unknown> }>();
const pending = new Map<string, Promise<SecStamped<unknown>>>();

/** Tests: forget everything. */
export function clearSecCache(): void {
  memo.clear();
  pending.clear();
}

async function load<T>(path: "/sec/facts" | "/sec/filings", ticker: string, ok: (v: unknown) => v is T, stamp: (d: T) => SecStamped<T>, opts: SecFetchOptions): Promise<SecStamped<T>> {
  const t = normalizeTicker(ticker);
  if (!t) throw new SecError("invalid_query", "Bitte ein Börsenkürzel angeben, zum Beispiel AAPL.", 0, "invalid_query");
  const key = `${path}:${t}`;
  const now = Date.now();
  const hit = memo.get(key);
  if (!opts.fresh && hit && now - hit.at < TTL_MS) return hit.value as SecStamped<T>;
  const running = pending.get(key);
  if (running && !opts.signal) return running as Promise<SecStamped<T>>;
  const p = (async (): Promise<SecStamped<unknown>> => {
    let raw: unknown;
    try {
      raw = await apiFetch<unknown>(path, { query: { ticker: t }, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) });
    } catch (e) {
      throw toSecError(e);
    }
    if (!ok(raw)) throw new SecError("invalid", "Die Antwort des Servers hat nicht das erwartete Format.", 200, "invalid_shape");
    const value = stamp(raw);
    memo.set(key, { at: Date.now(), value });
    return value;
  })();
  if (!opts.signal) {
    pending.set(key, p);
    void p.then(
      () => pending.delete(key),
      () => pending.delete(key),
    );
  }
  return p as Promise<SecStamped<T>>;
}

/** The reduced company facts of a ticker. Throws `SecError`. */
export function fetchSecFacts(ticker: string, opts: SecFetchOptions = {}): Promise<SecStamped<SecFactsPayload>> {
  return load(
    "/sec/facts",
    ticker,
    factsOk,
    (d) => ({ data: d, source: SEC_SOURCE, sourceLabel: SEC_SOURCE_LABEL, sourceUrl: d.sourceUrl, asOf: msOfIso(d.asOf), receivedAt: d.fetchedAt, cached: d.cached, stale: d.stale === true }),
    opts,
  );
}

/** The newest 10-Q / 10-K / 8-K of a ticker, with the earnings 8-K and its press release. Throws `SecError`. */
export function fetchSecFilings(ticker: string, opts: SecFetchOptions = {}): Promise<SecStamped<SecFilingsPayload>> {
  return load(
    "/sec/filings",
    ticker,
    filingsOk,
    (d) => ({ data: d, source: SEC_SOURCE, sourceLabel: SEC_SOURCE_LABEL, sourceUrl: d.sourceUrl, asOf: msOfIso(d.filings[0]?.filed ?? null), receivedAt: d.fetchedAt, cached: d.cached, stale: d.stale === true }),
    opts,
  );
}
