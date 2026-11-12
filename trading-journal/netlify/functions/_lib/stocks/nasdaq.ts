/**
 * Nasdaq Trader symbol directories → the list of US common stocks and ADRs the scanner may look at.
 *
 * Source: `nasdaqlisted.txt` (Nasdaq-listed) and `otherlisted.txt` (NYSE, NYSE American, NYSE Arca, Cboe, IEX) from
 * https://www.nasdaqtrader.com/dynamic/SymDir/ – public pipe-separated files, rewritten every night. Rule, in order
 * (the one the trader-scanner skill documents, so the counts can be compared):
 *   1. not a test issue, not an ETF, not NextShares
 *   2. a plain ticker: 1–5 letters, or 1–4 letters + `.` + one class letter (`BRK.B`); `.U` / `.W` / `.R` and `$` are out
 *   3. out, whatever else the name says: warrants; SPAC units and rights; notes, ETNs, debentures; a `%` coupon;
 *      "Depositary Shares" that are not American / Global (those carry a preferred)
 *   4. in: the name calls it common stock / shares / units, ordinary shares, shares of beneficial interest,
 *      ADS / ADR / American or Global depositary shares, or partnership / trust units
 *   5. out: the name still says unit, right, bond, preferred or preference
 *   6. in: everything else ("AMETEK, Inc.")
 * Pure functions (`parseDirectory`, `classify`, `buildDirectory`) and one fetch (`fetchDirectory`, injectable).
 */
import { nyToUtc } from "../../../../src/market/stocks/session";
import type { SymbolDirectory, SymbolEntry } from "../../../../src/market/stocks/types";

export const NASDAQ_BASE = "https://www.nasdaqtrader.com/dynamic/SymDir/";
export const NASDAQ_FILES = ["nasdaqlisted.txt", "otherlisted.txt"] as const;
export type NasdaqFile = (typeof NASDAQ_FILES)[number];

export type Row = Record<string, string>;

const TICKER = /^[A-Z]{1,5}$|^[A-Z]{1,4}\.[A-Z]$/;
const ALWAYS_OUT: readonly (readonly [string, RegExp])[] = [
  ["Warrants", /\bwarrants?\b/],
  ["Units und Rechte", /\b(units?|rights?),? (each|that|entitling)\b|(?<!the )\brights? to\b/],
  ["Anleihen und Notes", /\b(notes?|etns?|debentures?)\b/],
  ["Kupon", /%/],
  ["Depositary Shares auf Vorzugsaktien", /(?<!american )(?<!global )\bdepositary shares?\b/],
];
const COMMON =
  /\bcommon (stock|shares?|units?)\b|\bord(inary)? shares?\b|\bshares? of beneficial interest\b|\b(american|global) deposit[ao]ry\b|\bads[s]?\b|\badrs?\b|\b(limited partnership|partnership|trust) units?\b|\bl\.?p\.? units?\b|\bunits? (of|representing)\b.*\b(limited partner|partnership|beneficial interest|limited liability)/;
const SOFT_OUT: readonly (readonly [string, RegExp])[] = [
  ["Units", /\bunits?\b/],
  ["Rechte", /\brights?\b/],
  ["Anleihen", /\bbonds?\b/],
  ["Vorzugsaktien", /\bpreferred\b|\bpreference\b/],
];

export const KEEP = "keep";

/** One directory row → `"keep"` or the German reason it is left out. */
export function classify(row: Row): string {
  const sym = (row["Symbol"] ?? row["ACT Symbol"] ?? "").trim();
  if ((row["Test Issue"] ?? "").trim() !== "N") return "Test-Papiere";
  if ((row["ETF"] ?? "").trim() !== "N") return "ETFs";
  if ((row["NextShares"] ?? "N").trim() !== "N") return "NextShares";
  if (!TICKER.test(sym)) return "Kein einfaches Kürzel";
  if (/\.[UWR]$/.test(sym)) return "Units, Warrants und Rechte (Kürzel)";
  const name = (row["Security Name"] ?? "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  for (const [tag, rx] of ALWAYS_OUT) if (rx.test(name)) return tag;
  if (COMMON.test(name)) return KEEP;
  for (const [tag, rx] of SOFT_OUT) if (rx.test(name)) return tag;
  return KEEP;
}

/** `File Creation Time: 1023202621:31` (MMDDYYYYHH:MM, New York time) → UTC ms. */
export function fileTimeOf(line: string): number | null {
  const m = /(\d{2})(\d{2})(\d{4})(\d{2}):(\d{2})/.exec(line);
  if (!m) return null;
  const [, mo, d, y, hh, mm] = m as unknown as [string, string, string, string, string, string];
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || Number(hh) > 23 || Number(mm) > 59) return null;
  return nyToUtc(`${y}-${mo}-${d}`, Number(hh) * 60 + Number(mm));
}

export class DirectoryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectoryFormatError";
  }
}

/** The pipe file → rows and its creation time. The last line is the `File Creation Time` footer. */
export function parseDirectory(text: string): { rows: Row[]; fileTime: number | null } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const first = lines[0];
  if (!first || !first.includes("|")) throw new DirectoryFormatError("Das ist kein Nasdaq-Trader-Verzeichnis.");
  const header = first.split("|").map((h) => h.trim());
  if (!header.includes("Security Name") || !(header.includes("Symbol") || header.includes("ACT Symbol"))) throw new DirectoryFormatError("Die Kopfzeile des Verzeichnisses ist unbekannt.");
  const rows: Row[] = [];
  let fileTime: number | null = null;
  for (const line of lines.slice(1)) {
    if (line.startsWith("File Creation Time")) {
      fileTime = fileTimeOf(line);
      continue;
    }
    const cells = line.split("|");
    const row: Row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    rows.push(row);
  }
  return { rows, fileTime };
}

const EXCHANGE: Readonly<Record<string, string>> = { N: "NYSE", A: "NYSE American", P: "NYSE Arca", Z: "Cboe BZX", V: "IEX", M: "NYSE Chicago", F: "TXSE" };

/** Both files → the directory: kept entries sorted by symbol, how many rows were read and why the others were left out. */
export function buildDirectory(files: Readonly<Record<NasdaqFile, string>>): SymbolDirectory {
  const kept = new Map<string, SymbolEntry>();
  const dropped: Record<string, number> = {};
  let rows = 0;
  let fileTime: number | null = null;
  for (const name of NASDAQ_FILES) {
    const parsed = parseDirectory(files[name]);
    fileTime = fileTime ?? parsed.fileTime;
    for (const row of parsed.rows) {
      rows++;
      const why = classify(row);
      if (why !== KEEP) {
        dropped[why] = (dropped[why] ?? 0) + 1;
        continue;
      }
      const symbol = (row["Symbol"] ?? row["ACT Symbol"] ?? "").trim();
      const isNasdaq = name === "nasdaqlisted.txt";
      kept.set(symbol, {
        symbol,
        name: (row["Security Name"] ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, 90),
        exchange: isNasdaq ? "NASDAQ" : (EXCHANGE[(row["Exchange"] ?? "").trim()] ?? "Andere"),
        fin: isNasdaq ? ((row["Financial Status"] ?? "").trim() || null) : null,
      });
    }
  }
  const entries = [...kept.values()].sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  return { entries, fileTime, counts: { rows, kept: entries.length, dropped } };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class DirectoryFetchError extends Error {
  constructor(
    readonly reason: "upstream" | "blocked" | "rate-limited" | "timeout",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DirectoryFetchError";
  }
}

/** Downloads both files (in parallel, 12 s each) and builds the directory. */
export async function fetchDirectory(fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<SymbolDirectory> {
  const get = async (name: NasdaqFile): Promise<string> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetchFn(`${NASDAQ_BASE}${name}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; TradingJournal/1.0)", accept: "text/plain,*/*" }, signal: ctrl.signal });
      if (res.status === 429) throw new DirectoryFetchError("rate-limited", "Nasdaq Trader begrenzt die Abrufe gerade.", 429);
      if (res.status === 401 || res.status === 403) throw new DirectoryFetchError("blocked", `Nasdaq Trader verweigert den Abruf (HTTP ${res.status}).`, res.status);
      if (!res.ok) throw new DirectoryFetchError("upstream", `Nasdaq Trader antwortet mit HTTP ${res.status}.`, res.status);
      return await res.text();
    } catch (e) {
      if (e instanceof DirectoryFetchError) throw e;
      const aborted = typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
      throw new DirectoryFetchError(aborted ? "timeout" : "upstream", aborted ? "Nasdaq Trader antwortet nicht rechtzeitig." : "Nasdaq Trader ist nicht erreichbar.");
    } finally {
      clearTimeout(timer);
    }
  };
  const [a, b] = await Promise.all([get("nasdaqlisted.txt"), get("otherlisted.txt")]);
  return buildDirectory({ "nasdaqlisted.txt": a, "otherlisted.txt": b });
}
