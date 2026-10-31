/**
 * Wire contract of `GET /api/v1/industry/daily`: the daily returns of the 48 US industries from Kenneth R. French's data library
 * (value-weighted table of `48_Industry_Portfolios_daily_CSV.zip`), packed small.
 *
 * PURE and alias-free: the function (`netlify/functions/industry-daily.mts`) imports this file by RELATIVE path, the app as
 * `@/market/industry`. Nothing here touches the network or the DOM.
 *
 * Packing (`encoding`): one binary block, gzip-compressed, then base64 inside the JSON –
 *   `days` × Int32 little-endian (the trading days as YYYYMMDD), then `names.length × days` × Int16 little-endian (the returns in
 *   hundredths of a percent, i.e. basis points, industry after industry); `-32768` = the library has no value that day
 *   (it writes -99.99 or -999). The library gives two decimals, so basis points lose nothing.
 *
 * What the data is, in one place (the UI says it too): a monthly-updated research file of US stocks (CRSP), value-weighted
 * industry portfolios from 1926, a month or two behind – no real-time data, not a price feed.
 */

export const INDUSTRY_SOURCE = "ken-french" as const;
export const INDUSTRY_SOURCE_LABEL = "Kenneth R. French Data Library (Dartmouth)";
export const INDUSTRY_SOURCE_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html";
export const INDUSTRY_ZIP_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/48_Industry_Portfolios_daily_CSV.zip";
export const INDUSTRY_MISSING = -32768;
export const INDUSTRY_ENCODING = "int32le-dates+int16le-industry-major;gzip;base64" as const;
export const INDUSTRY_COUNT = 48;

/** Bounds the reader and the validators hold to – a file outside them is a changed format, not data. */
export const INDUSTRY_LIMITS = { minDays: 5000, maxDays: 60_000, maxBase64: 14_000_000 } as const;

export interface IndustryDailyPayload {
  source: typeof INDUSTRY_SOURCE;
  /** ms epoch when the SERVER read the file (a cached answer keeps its original time) */
  fetchedAt: number;
  /** the file's Last-Modified (ms epoch), `null` when the library sent none */
  fileTime: number | null;
  cached: boolean;
  /** the library could not be read just now and this is the last good copy (see `fetchedAt`) */
  stale?: boolean;
  /** the CRSP database the file says it was created from (`202609` = September 2026), `null` when the header changed */
  database: string | null;
  /** the library's short names, in file order */
  names: string[];
  days: number;
  firstDay: number;
  lastDay: number;
  encoding: typeof INDUSTRY_ENCODING;
  /** bytes of the block before gzip: `days × 4 + names.length × days × 2` */
  bytes: number;
  /** the block, gzip, base64 */
  data: string;
}

const isDay = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 19000101 && v <= 29991231;

/** Shape check of an answer – before a byte of `data` is decoded. */
export function industryPayloadOk(v: unknown): v is IndustryDailyPayload {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.source !== INDUSTRY_SOURCE || o.encoding !== INDUSTRY_ENCODING) return false;
  if (typeof o.fetchedAt !== "number" || !Number.isFinite(o.fetchedAt)) return false;
  if (o.fileTime !== null && (typeof o.fileTime !== "number" || !Number.isFinite(o.fileTime))) return false;
  if (typeof o.cached !== "boolean") return false;
  if (o.database !== null && typeof o.database !== "string") return false;
  if (!Array.isArray(o.names) || o.names.length < 1 || o.names.length > 100 || !o.names.every((n) => typeof n === "string" && /^[A-Za-z0-9]{1,12}$/.test(n))) return false;
  if (typeof o.days !== "number" || !Number.isInteger(o.days) || o.days < INDUSTRY_LIMITS.minDays || o.days > INDUSTRY_LIMITS.maxDays) return false;
  if (!isDay(o.firstDay) || !isDay(o.lastDay) || o.firstDay >= o.lastDay) return false;
  if (o.bytes !== o.days * 4 + (o.names as unknown[]).length * o.days * 2) return false;
  return typeof o.data === "string" && o.data.length > 0 && o.data.length <= INDUSTRY_LIMITS.maxBase64;
}
