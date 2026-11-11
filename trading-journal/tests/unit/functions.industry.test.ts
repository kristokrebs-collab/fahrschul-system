// @vitest-environment node
/// <reference types="node" />
/**
 * The industry-data function (`industry-daily`) with a mocked `fetch` that serves a ZIP in the library's own layout (intro text, the
 * value-weighted table, a second table that must be ignored, the copyright line): what the reader takes, how it packs, the 6-hour cache,
 * the stale copy, the rate limit and every typed failure – a library that is down, slow or has changed its file is named, never papered over.
 */
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INDUSTRY_STALE_MS, INDUSTRY_TTL_MS, INDUSTRY_USER_AGENT, IndustryFormatError, parseIndustryCsv, setIndustryForTests } from "../../netlify/functions/_lib/industry/load";
import { resetGuardForTests } from "../../netlify/functions/_lib/stocks/guard";
import industryDaily from "../../netlify/functions/industry-daily.mts";
import { INDUSTRY_COUNT, INDUSTRY_MISSING, INDUSTRY_ZIP_URL, industryPayloadOk, type IndustryDailyPayload } from "../../src/market/industry/wire";
import { INDUSTRY_NAMES } from "../../src/domain/industryTrend/config";
import { reply, zipOf } from "./congress.harness";

const ctx = { ip: "203.0.113.7" } as Parameters<typeof industryDaily>[1];
const NAMES = Object.keys(INDUSTRY_NAMES);
const DAYS = 5200;

/** day `k` as YYYYMMDD on a calendar of 30-day months (only the order matters here) */
const dayOf = (k: number): string => {
  const y = 1990 + Math.floor(k / 360);
  const m = 1 + Math.floor((k % 360) / 30);
  const d = 1 + (k % 30);
  return `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
};
/** the cell of industry `i` on day `k`: a few missing, otherwise a small number with two decimals */
const cell = (i: number, k: number): string => (k < 3 && i % 5 === 0 ? "-99.99" : (((i * 7 + k * 13) % 401) / 100 - 2).toFixed(2));

function csv(opts: { days?: number; names?: string[]; header?: string; badRow?: string; extraTable?: boolean } = {}): string {
  const days = opts.days ?? DAYS;
  const names = opts.names ?? NAMES;
  const out = [
    "This file was created using the 202609 CRSP database.",
    "It contains value- and equal-weighted returns for 48 industry portfolios.",
    "",
    "Missing data are indicated by -99.99 or -999.",
    "",
    "",
    opts.header ?? "  Average Value Weighted Returns -- Daily",
    `,${names.join(",")}`,
  ];
  for (let k = 0; k < days; k++) out.push(`${dayOf(k)},${names.map((_, i) => cell(i, k).padStart(7)).join(",")}`);
  if (opts.badRow) out.push(opts.badRow);
  out.push("", "  Average Equal Weighted Returns -- Daily", `,${names.join(",")}`);
  if (opts.extraTable !== false) for (let k = 0; k < 10; k++) out.push(`${dayOf(k)},${names.map(() => "9.99").join(",")}`);
  out.push("", "Copyright 2026 Eugene F. Fama and Kenneth R. French");
  return out.join("\n");
}

const LM = "Mon, 26 Oct 2026 13:57:00 GMT";
const zipReply = (text: string = csv(), extra: Record<string, string> = {}): Response => reply(zipOf(text, "48_Industry_Portfolios_Daily.csv"), 200, { "content-type": "application/zip", "last-modified": LM, ...extra });

const get = (auth = false): Promise<Response> => industryDaily(new Request("https://x.test/api/v1/industry/daily", { headers: auth ? { authorization: "Bearer not-a-jwt" } : {} }), ctx);
const body = async (res: Response): Promise<IndustryDailyPayload> => {
  const b: unknown = await res.json();
  expect(industryPayloadOk(b)).toBe(true);
  return b as IndustryDailyPayload;
};
const err = async (res: Response): Promise<{ code: string; message: string }> => ((await res.json()) as { error: { code: string; message: string } }).error;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetGuardForTests();
  fetchMock = vi.fn(async () => zipReply());
  setIndustryForTests({ fetch: fetchMock as unknown as typeof fetch });
});
afterEach(() => {
  vi.useRealTimers();
  setIndustryForTests(null);
});

describe("Lesen der Datei", () => {
  it("nimmt nur die wertgewichtete Tabelle: 48 Branchen, alle Tage, ganze Hundertstel-Prozent, fehlende Werte als -32768", () => {
    const p = parseIndustryCsv(csv());
    expect(p.names).toEqual(NAMES);
    expect(p.names).toHaveLength(INDUSTRY_COUNT);
    expect(p.dates).toHaveLength(DAYS);
    expect(p.returns).toHaveLength(INDUSTRY_COUNT * DAYS);
    expect(p.database).toBe("202609");
    // Branche 0 (Agric) am Tag 0 fehlt, am Tag 5 nicht: cell(0, 5) = ((0 + 65) % 401) / 100 - 2 = -1.35
    expect(p.returns[0]).toBe(INDUSTRY_MISSING);
    expect(p.returns[5]).toBe(-135);
    // Branche 1, Tag 2: ((7 + 26) % 401)/100 - 2 = -1.67 – Branche steht hinter Branche (branchenweise abgelegt)
    expect(p.returns[1 * DAYS + 2]).toBe(-167);
    // die zweite Tabelle (alle 9,99) wird nicht gelesen
    expect(p.returns.includes(999)).toBe(false);
  });

  it("-999 und -99,99 sind beide „fehlt“", () => {
    const p = parseIndustryCsv(csv().replace("-99.99", "-999.00"));
    expect(p.returns[0]).toBe(INDUSTRY_MISSING);
  });

  it("zu wenige Branchen, eine andere Kopfzeile, Tage rückwärts, zu wenige Tage, ein Wort statt einer Zahl, ein riesiger Wert: Formatfehler mit Grund", () => {
    expect(() => parseIndustryCsv(csv({ names: NAMES.slice(0, 47) }))).toThrow(IndustryFormatError);
    expect(() => parseIndustryCsv(csv({ header: "  Something else" }))).toThrow(/fehlt/);
    expect(() => parseIndustryCsv(csv({ days: 100 }))).toThrow(/wenige Tage/);
    expect(() => parseIndustryCsv(csv({ badRow: `${dayOf(1)},${NAMES.map(() => "1.00").join(",")}` }))).toThrow(/nicht aufsteigend/);
    expect(() => parseIndustryCsv(csv({ badRow: `${dayOf(DAYS + 1)},${NAMES.map(() => "abc").join(",")}` }))).toThrow(/keine Zahl/);
    expect(() => parseIndustryCsv(csv({ badRow: `${dayOf(DAYS + 1)},${NAMES.map(() => "999.00").join(",")}` }))).toThrow(/außerhalb/);
    expect(() => parseIndustryCsv(csv({ badRow: `${dayOf(DAYS + 1)},1.00,2.00` }))).toThrow(/statt 48 Werte/);
  });
});

describe("Antwort der Funktion", () => {
  it("packt klein, ist vollständig angekündigt und lässt sich genau wieder auspacken", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    const p = await body(res);
    expect(p).toMatchObject({ source: "ken-french", cached: false, database: "202609", days: DAYS, firstDay: 19900101, encoding: "int32le-dates+int16le-industry-major;gzip;base64" });
    expect(p.fileTime).toBe(Date.parse(LM));
    expect(p.names).toEqual(NAMES);
    // der Block enthält zuerst die Tage, dann die Renditen
    const raw = gunzipSync(Buffer.from(p.data, "base64"));
    expect(raw.length).toBe(p.bytes);
    expect(raw.readInt32LE(0)).toBe(p.firstDay);
    expect(raw.readInt32LE((DAYS - 1) * 4)).toBe(p.lastDay);
    expect(raw.readInt16LE(DAYS * 4 + 5 * 2)).toBe(-135);
    // klein: weit unter dem Antwortlimit der Plattform (6 MB) und unter dem Rohblock
    expect(p.data.length).toBeLessThan(raw.length);
  });

  it("holt die feste Adresse mit eigenem User-Agent und ohne Anmeldedaten des Nutzers", async () => {
    await get(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(INDUSTRY_ZIP_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers["user-agent"]).toBe(INDUSTRY_USER_AGENT);
    expect(Object.keys(headers).sort()).toEqual(["accept", "user-agent"]);
  });

  it("merkt sich die Datei 6 Stunden und teilt einen Abruf unter gleichzeitigen Anfragen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
    const [a, b] = await Promise.all([get(), get()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([(await body(a)).cached, (await body(b)).cached].sort()).toEqual([false, true]);
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z").getTime() + INDUSTRY_TTL_MS - 60_000);
    expect((await body(await get())).cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z").getTime() + INDUSTRY_TTL_MS + 60_000);
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fällt bei einem Ausfall auf die ältere Kopie zurück und sagt es (stale, mit der ersten Lesezeit) – bis 90 Tage", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-10-31T10:00:00Z").getTime();
    vi.setSystemTime(t0);
    const first = await body(await get());
    fetchMock.mockImplementation(async () => reply("down", 503));
    vi.setSystemTime(t0 + INDUSTRY_TTL_MS + 1000);
    const stale = await body(await get());
    expect(stale.stale).toBe(true);
    expect(stale.fetchedAt).toBe(first.fetchedAt);
    expect(stale.data).toBe(first.data);
    vi.setSystemTime(t0 + INDUSTRY_STALE_MS + 1000);
    const res = await get();
    expect(res.status).toBe(502);
    expect((await err(res)).code).toBe("industry_upstream");
  });
});

describe("Fehler mit Grund", () => {
  it("die Bibliothek antwortet mit einem Fehler: 502 industry_upstream mit dem Statuscode im Text", async () => {
    fetchMock.mockImplementation(async () => reply("nope", 500));
    const res = await get();
    expect(res.status).toBe(502);
    const e = await err(res);
    expect(e.code).toBe("industry_upstream");
    expect(e.message).toContain("HTTP 500");
  });

  it("keine Verbindung: 502, ohne den Rohfehler preiszugeben", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("getaddrinfo ENOTFOUND secret.internal");
    });
    const res = await get();
    expect(res.status).toBe(502);
    const e = await err(res);
    expect(e.message).toMatch(/nicht erreichbar/);
    expect(JSON.stringify(e)).not.toContain("secret.internal");
  });

  it("zu langsam: 504 industry_timeout (der Abruf wird nach 8 s abgebrochen)", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const p = get();
    await vi.advanceTimersByTimeAsync(8_100);
    const res = await p;
    expect(res.status).toBe(504);
    expect((await err(res)).code).toBe("industry_timeout");
  });

  it("zu groß angekündigt: nicht gelesen", async () => {
    fetchMock.mockImplementation(async () => zipReply(csv(), { "content-length": String(50 * 1024 * 1024) }));
    const res = await get();
    expect(res.status).toBe(502);
    expect((await err(res)).message).toMatch(/ungewöhnlich groß/);
  });

  it("geänderter Aufbau: 502 industry_format – die Zahlen werden nicht geraten", async () => {
    fetchMock.mockImplementation(async () => zipReply(csv({ names: NAMES.slice(0, 40) })));
    const res = await get();
    expect(res.status).toBe(502);
    const e = await err(res);
    expect(e.code).toBe("industry_format");
    expect(e.message).toMatch(/Aufbau hat sich vermutlich geändert/);
  });

  it("kein ZIP: ebenfalls Formatfehler", async () => {
    fetchMock.mockImplementation(async () => reply("<html>Wartung</html>", 200, { "content-type": "text/html" }));
    const res = await get();
    expect(res.status).toBe(502);
    expect((await err(res)).code).toBe("industry_format");
  });
});

describe("Zugang", () => {
  it("nur GET", async () => {
    const res = await industryDaily(new Request("https://x.test/api/v1/industry/daily", { method: "POST" }), ctx);
    expect(res.status).toBe(405);
  });

  it("begrenzt die Abrufe je Adresse (20 je 10 Minuten) mit Retry-After", async () => {
    for (let i = 0; i < 20; i++) expect((await get()).status).toBe(200);
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    // die Datei wurde dafür nur einmal geholt
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
