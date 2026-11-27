// @vitest-environment node
/// <reference types="node" />
/**
 * The Congress tracker's reader on REAL files of the House Clerk (fixtures fetched 2026-10-26, see
 * `tests/fixtures/congress/README.md`): the yearly index (ZIP → XML → filings), the Periodic Transaction Report PDFs (RC4-encrypted
 * forms read without a PDF library → rows), the page-break glue, the owners / sides / options / amounts the filings print, and the
 * refusals: what the reader cannot read cleanly is an unreadable row or report with a reason – never a guess.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reportOfPdf } from "../../netlify/functions/_lib/congress/load";
import { parseToUnicode, PdfError, readPdfText } from "../../netlify/functions/_lib/congress/pdf";
import { readZipEntry, ZipError } from "../../netlify/functions/_lib/congress/zip";
import { ClerkFormatError, decodeXml, indexUrl, isoOfMdy, parseIndexXml, ptrUrl } from "../../src/market/congress/clerk";
import { parseAmount, parseOption, parsePtr, type PageText, type TextItem } from "../../src/market/congress/ptr";
import type { CongressTrade } from "../../src/market/congress/wire";
import { SCAN_PDF } from "./congress.harness";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/congress");
const file = (n: string): Buffer => readFileSync(join(FIX, n));
const report = (id: string) => parsePtr(readPdfText(file(`${id}.pdf`)));
const trades = (id: string): CongressTrade[] => report(id).rows.filter((r): r is CongressTrade => r.ok);

describe("the Clerk's yearly index", () => {
  const zip = readZipEntry(file("2026FD.zip"), /\.xml$/i);
  const idx = parseIndexXml(zip.data.toString("utf8"), 2026);

  it("reads the ZIP's XML entry and its New York time stamp", () => {
    expect(zip.name).toBe("2026FD.xml");
    // 2026-10-23 09:00:28 in the ZIP = New York wall clock (the server's own Last-Modified said 13:00:28 GMT)
    expect(zip.time).toBe(Date.UTC(2026, 9, 23, 9, 0, 28));
  });

  it("keeps the Periodic Transaction Reports of 1800 filings, newest first, with the PDF link", () => {
    expect(idx.total).toBe(1800);
    expect(idx.filings).toHaveLength(437);
    expect(idx.filings[0]).toEqual({ docId: "20035700", year: 2026, name: "Darrell E. Issa", last: "Issa", district: "CA48", filed: "2026-10-22", url: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035700.pdf" });
    const filed = idx.filings.map((f) => f.filed ?? "");
    expect([...filed].sort().reverse()).toEqual(filed);
    expect(idx.filings.every((f) => /^\d{6,9}$/.test(f.docId) && f.url === ptrUrl(2026, f.docId))).toBe(true);
  });

  it("finds the four 2026 reports of Nancy Pelosi named in the skill (filed 01/23, 06/23, 08/21 and 10/02)", () => {
    const p = idx.filings.filter((f) => f.last === "Pelosi");
    expect(p.map((f) => [f.docId, f.filed, f.name, f.district])).toEqual([
      ["20035553", "2026-10-02", "Nancy Pelosi", "CA11"],
      ["20035143", "2026-08-21", "Nancy Pelosi", "CA11"],
      ["20034836", "2026-06-23", "Nancy Pelosi", "CA11"],
      ["20033725", "2026-01-23", "Nancy Pelosi", "CA11"],
    ]);
  });

  it("writes a double first name as the index does", () => {
    expect(idx.filings.find((f) => f.docId === "20035408")).toMatchObject({ name: "April McClain Delaney", last: "Delaney" });
  });

  it("builds the two URLs", () => {
    expect(indexUrl(2026)).toBe("https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2026FD.zip");
    expect(ptrUrl(2025, "20031234")).toBe("https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2025/20031234.pdf");
  });

  it("decodes entities and reads a BOM, empty tags and a name with an apostrophe", () => {
    const xml = "﻿<?xml version=\"1.0\"?><FinancialDisclosure><Member><Prefix>Hon.</Prefix><Last>O&apos;Halleran</Last><First>Tom</First><Suffix /><FilingType>P</FilingType><StateDst>AZ01</StateDst><Year>2025</Year><FilingDate>12/1/2025</FilingDate><DocID>20031111</DocID></Member><Member><Last>Aaron</Last><First>Richard</First><FilingType>W</FilingType><DocID>8068</DocID></Member></FinancialDisclosure>";
    const r = parseIndexXml(xml, 2025);
    expect(r.total).toBe(2);
    expect(r.filings).toEqual([{ docId: "20031111", year: 2025, name: "Tom O'Halleran", last: "O'Halleran", district: "AZ01", filed: "2025-12-01", url: ptrUrl(2025, "20031111") }]);
    expect(decodeXml("A &amp; B &#38; C &#x26; D &unknown;")).toBe("A & B & C & D &unknown;");
  });

  it("calls a file in another shape a changed format, not an empty year", () => {
    expect(() => parseIndexXml("<html>Access denied</html>", 2026)).toThrow(ClerkFormatError);
    expect(() => parseIndexXml("<FinancialDisclosure></FinancialDisclosure>", 2026)).toThrow(/keine Einträge/);
    expect(() => parseIndexXml("<FinancialDisclosure><Member><Foo>1</Foo></Member></FinancialDisclosure>", 2026)).toThrow(ClerkFormatError);
  });

  it("reads American dates strictly", () => {
    expect(isoOfMdy("8/21/2026")).toBe("2026-08-21");
    expect(isoOfMdy("08/21/2026")).toBe("2026-08-21");
    expect(isoOfMdy("6/17/27")).toBe("2027-06-17");
    expect(isoOfMdy("2/30/2026")).toBeNull();
    expect(isoOfMdy("13/1/2026")).toBeNull();
    expect(isoOfMdy("2026-08-21")).toBeNull();
    expect(isoOfMdy(null)).toBeNull();
  });
});

describe("the ZIP reader", () => {
  it("refuses what is not a ZIP, a cut-off ZIP and a missing entry", () => {
    expect(() => readZipEntry(Buffer.from("not a zip at all, but long enough to try"), /\.xml$/)).toThrow(ZipError);
    expect(() => readZipEntry(file("2026FD.zip").subarray(0, 4000), /\.xml$/)).toThrow(ZipError);
    expect(() => readZipEntry(file("2026FD.zip"), /\.csv$/)).toThrow(/no matching entry/);
  });
});

describe("Periodic Transaction Reports (real PDFs)", () => {
  it("reads the report of the skill's example: Nancy Pelosi, filed 2026-08-21, 7 rows (spouse)", () => {
    const r = report("20035143");
    expect(r).toMatchObject({ filingId: "20035143", filer: "Hon. Nancy Pelosi", signed: "2026-08-21" });
    expect(r.problem).toBeUndefined();
    expect(r.rows).toHaveLength(7);
    const t = trades("20035143");
    expect(t).toHaveLength(7);
    expect(t.every((x) => x.owner === "spouse" && x.side === "buy")).toBe(true);
    // the first block: 10,000 Bloom Energy shares, $1,000,001 - $5,000,000, traded 07/24
    expect(t[0]).toMatchObject({ asset: "Bloom Energy Corporation Class A Common Stock", ticker: "BE", assetCode: "ST", tradeDate: "2026-07-24", notifiedDate: "2026-07-24", amountText: "$1,000,001 - $5,000,000", amountLow: 1000001, amountHigh: 5000000, shares: 10000, option: null, description: "Purchased 10,000 shares." });
    // the call options: 100 contracts, $100 strike, expiring 6/17/27
    expect(t[1]).toMatchObject({ ticker: "BE", assetCode: "OP", option: { contracts: 100, kind: "call", strike: 100, expires: "2027-06-17", exercised: false } });
    // the second block on 07/28 and the Intel rows (asset name over two lines, ticker on the second)
    expect(t[2]).toMatchObject({ tradeDate: "2026-07-28", amountText: "$500,001 - $1,000,000", shares: 5000 });
    expect(t[3]).toMatchObject({ tradeDate: "2026-07-28", option: { contracts: 100, strike: 100 } });
    expect(t[4]).toMatchObject({ asset: "Intel Corporation - Common Stock", ticker: "INTC", assetCode: "OP", option: { contracts: 50, kind: "call", strike: 50, expires: "2027-06-17" }, amountText: "$250,001 - $500,000" });
    expect(t[5]).toMatchObject({ ticker: "INTC", assetCode: "ST", shares: 10000 });
    // a private LLC: no ticker, and nothing made up for it
    expect(t[6]).toMatchObject({ asset: "REOF XXV, LLC", ticker: null, assetCode: "AB", tradeDate: "2026-07-27", shares: null, option: null });
  });

  it("glues a row that runs over a page break (asset line and type code on the next page)", () => {
    const r = report("20035408");
    expect(r.rows).toHaveLength(78);
    const t = trades("20035408");
    expect(t).toHaveLength(78);
    expect(t.every((x) => x.owner === "child" && x.ticker && x.assetCode === "ST")).toBe(true);
    const split = t.find((x) => x.ticker === "CHRW" && x.tradeDate === "2026-08-05");
    expect(split).toMatchObject({ asset: "C.H. Robinson Worldwide, Inc. - Common Stock", assetCode: "ST", side: "buy", amountText: "$1,001 - $15,000", notifiedDate: "2026-09-01" });
    expect(t.filter((x) => x.side === "sell").length).toBe(33);
    expect(t.filter((x) => x.side === "sell-partial").length).toBe(25);
    expect(t.filter((x) => x.side === "buy").length).toBe(20);
  });

  it("keeps an option whose description names no strike or expiry, with the description as printed", () => {
    const t = trades("20034694");
    expect(t).toHaveLength(6);
    const put = t.find((x) => x.description === "Put Option")!;
    expect(put.option).toEqual({ contracts: null, kind: "put", strike: null, expires: null, exercised: false });
    expect(put.owner).toBe("spouse");
    const call = t.find((x) => x.description === "Call option contracts.")!;
    expect(call.option?.kind).toBe("call");
    expect(call.assetCode).toBe("ST");
  });

  it("keeps a single printed figure as printed and never turns it into a range", () => {
    const [x] = trades("20034999");
    expect(x).toMatchObject({ ticker: "ICHR", side: "sell", owner: "self", amountText: "$2,722.50", amountLow: null, amountHigh: null, description: "Sale from Individual Retirement Account" });
  });

  it("reads free-text options only where a word states them (a price after 'at' is not taken for the strike)", () => {
    const t = trades("20035024");
    const puts = t.filter((x) => x.description?.startsWith("10 puts at"));
    expect(puts).toHaveLength(2);
    for (const p of puts) expect(p.option).toEqual({ contracts: 10, kind: "put", strike: null, expires: null, exercised: false });
    // an ETF the member could not find: a row without ticker and its own explanation
    expect(t.find((x) => x.asset === "FAS")).toMatchObject({ ticker: null, assetCode: "OT" });
  });
});

describe("amounts and options", () => {
  it("reads the ranges the form prints", () => {
    expect(parseAmount("$1,001 - $15,000")).toEqual({ low: 1001, high: 15000 });
    expect(parseAmount("$1,000,001 -   $5,000,000")).toEqual({ low: 1000001, high: 5000000 });
    expect(parseAmount("Over $50,000,000")).toEqual({ low: 50000000, high: null });
    expect(parseAmount("$250")).toEqual({ low: 250, high: 250 });
    expect(parseAmount("$2,722.50")).toBeNull();
    expect(parseAmount("about 5k")).toBeNull();
  });

  it("reads the descriptions members write", () => {
    expect(parseOption("Purchased 100 call options with a strike price of $100 and an expiration date of 6/17/27.", "OP")).toEqual({ contracts: 100, kind: "call", strike: 100, expires: "2027-06-17", exercised: false });
    expect(parseOption("Call options; Strike price $325; Expires 06/18/2026", "OP")).toEqual({ contracts: null, kind: "call", strike: 325, expires: "2026-06-18", exercised: false });
    expect(parseOption("Exercised 50 call options with a strike price of $150 and an expiration date of 1/16/26.", "ST")).toMatchObject({ contracts: 50, kind: "call", strike: 150, expires: "2026-01-16", exercised: true });
    expect(parseOption("Sold 20 put options with a strike price of $1,250.50", "OP")).toMatchObject({ contracts: 20, kind: "put", strike: 1250.5, expires: null });
    expect(parseOption("Capital call of $1,432.26", "OT")).toBeNull();
    expect(parseOption("Purchased 10,000 shares.", "ST")).toBeNull();
    expect(parseOption(null, "OP")).toEqual({ contracts: null, kind: null, strike: null, expires: null, exercised: false });
    expect(parseOption(null, "ST")).toBeNull();
  });
});

/* -------------------------------------------------------------------------------------------- refusals */

const it_ = (x: number, y: number, text: string, size = 9): TextItem => ({ x, y, text, size });
/** the header row of the form at the real column positions */
const header = (y = 288.7): TextItem[] => [
  it_(25.3, y, "ID", 9.4),
  it_(65.1, y, "Owner", 9.4),
  it_(104.1, y, "Asset", 9.4),
  it_(260.8, y, "Transaction", 9.4),
  it_(325.3, y, "Date", 9.4),
  it_(380.8, y, "Notification", 9.4),
  it_(445.3, y, "Amount", 9.4),
  it_(524.8, y, "Cap.", 9.4),
  it_(260.8, y + 11.3, "Type", 9.4),
  it_(380.8, y + 11.3, "Date", 9.4),
  it_(524.8, y + 22.5, "$200?", 9.4),
];
interface Spec {
  owner?: string;
  asset?: string[];
  type?: string;
  date?: string;
  notified?: string;
  amount?: string[];
  labels?: boolean;
}
const row = (y: number, s: Spec): TextItem[] => {
  const out: TextItem[] = [];
  if (s.owner) out.push(it_(64.9, y, s.owner));
  (s.asset ?? ["Acme Corp. Common Stock (ACME) [ST]"]).forEach((a, i) => out.push(it_(103.9, y + i * 10.5, a)));
  if (s.type !== "") out.push(it_(260.7, y, s.type ?? "P"));
  if (s.date !== "") out.push(it_(325.2, y, s.date ?? "07/24/2026"));
  out.push(it_(380.7, y, s.notified ?? "07/24/2026"));
  (s.amount ?? ["$1,001 - $15,000"]).forEach((a, i) => out.push(it_(445.2, y + i * 10.5, a)));
  if (s.labels !== false) {
    out.push(it_(103.8, y + 27, "F S: New", 8.5));
    out.push(it_(103.8, y + 40, "D: Purchased 10 shares.", 8.5));
  }
  return out;
};
const page = (items: TextItem[]): PageText => ({ width: 612, height: 792, items });
const form = (...rows: TextItem[][]): PageText[] => [page([it_(485, 80, "Filing ID #20000001"), it_(21.7, 198, "Name:", 9.7), it_(99, 198, "Hon. Test Member", 9.7), ...header(), ...rows.flat()])];

describe("what the reader refuses to guess", () => {
  it("reads a clean synthetic form (the control for the cases below)", () => {
    const r = parsePtr(form(row(333, { owner: "SP" }), row(400, { owner: "", asset: ["Foo Inc. (FOO) [ST]"], type: "S (partial)", date: "08/01/2026" })));
    expect(r.problem).toBeUndefined();
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ ok: true, owner: "spouse", ticker: "ACME", side: "buy" });
    expect(r.rows[1]).toMatchObject({ ok: true, owner: "self", ticker: "FOO", side: "sell-partial", tradeDate: "2026-08-01" });
  });

  it("makes a row without an amount an unreadable row with the reason – and keeps the neighbours", () => {
    const r = parsePtr(form(row(333, { amount: [] }), row(400, {})));
    expect(r.problem).toBeUndefined();
    expect(r.rows[0]).toMatchObject({ ok: false, reason: "Betragsspanne fehlt." });
    expect(r.rows[1]).toMatchObject({ ok: true });
  });

  it("refuses an unknown owner code, an unknown type and a trade date that is no date", () => {
    const r = parsePtr(form(row(333, { owner: "XX" }), row(400, { type: "Q" }), row(467, { date: "13/45/2026" })));
    expect(r.rows.map((x) => (x.ok ? "ok" : x.reason))).toEqual(["Eigentümer-Kürzel „XX“ unbekannt.", expect.stringContaining("Geschäftsart"), "Handelsdatum nicht lesbar."]);
  });

  it("treats a report whose rows and status labels do not add up as unreadable as a whole", () => {
    const r = parsePtr(form(row(333, {}), row(400, { labels: false })));
    expect(r.problem).toBe("format");
    expect(r.message).toMatch(/passen nicht zusammen/);
    expect(r.rows).toEqual([]);
  });

  it("treats a page without the table header as a changed form", () => {
    const r = parsePtr([page([it_(21.7, 198, "Name:", 9.7), it_(99, 198, "Hon. Test", 9.7), it_(100, 300, "Something else entirely")])]);
    expect(r.problem).toBe("format");
  });

  it("calls a document without any text a scanned paper form", () => {
    expect(parsePtr([page([])]).problem).toBe("scan");
    expect(parsePtr([]).problem).toBe("format");
  });

  it("reads a form with the header and no transaction as a report without rows", () => {
    const r = parsePtr(form());
    expect(r.problem).toBeUndefined();
    expect(r.rows).toEqual([]);
  });

  it("does not take lines before the first row of a report for a row", () => {
    const stray = [it_(103.9, 320, "Orphan line without an owner or date")];
    expect(parsePtr(form(stray, row(333, {}))).problem).toBe("format");
  });
});

describe("the PDF reader", () => {
  it("answers garbage, a text file and an empty file with a typed error, never anything else", () => {
    for (const bytes of [Buffer.from(""), Buffer.from("hello"), Buffer.from("%PDF-1.4\nnothing else"), Buffer.alloc(2000, 7)]) {
      expect(() => readPdfText(bytes)).toThrow(PdfError);
    }
  });

  it("calls a scanned paper filing (object stream, page images, no font) a scan", () => {
    const scan = "%PDF-1.5\n1 0 obj\n<< /Type /ObjStm /N 1 /First 8 /Length 4 >>\nstream\n0 0 \nendstream\nendobj\n2 0 obj\n<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /Length 2 >>\nstream\n\u0000\u0000\nendstream\nendobj\ntrailer\n<< /Root 3 0 R >>\n%%EOF\n";
    try {
      readPdfText(Buffer.from(scan, "latin1"));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PdfError);
      expect((e as PdfError).kind).toBe("scan");
    }
  });

  it("refuses a security handler it does not know and a password it cannot open", () => {
    const pdf = file("20035143.pdf");
    const text = pdf.toString("latin1");
    const unknown = Buffer.from(text.replace("/Filter /Standard", "/Filter /Standarx"), "latin1");
    expect(() => readPdfText(unknown)).toThrow(/security handler/);
    // the owner entry changes the key: every stream then fails to decompress – "encrypted", not garbled text
    const m = /\/O <([0-9A-F]{2})/.exec(text)!;
    const flipped = Buffer.from(text.replace(m[0], `/O <${m[1] === "36" ? "37" : "36"}`), "latin1");
    try {
      readPdfText(flipped);
      expect.unreachable();
    } catch (e) {
      expect((e as PdfError).kind).toBe("encrypted");
    }
  });

  it("survives every cut of a real report with a typed error or a (possibly empty) text", () => {
    const pdf = file("20034999.pdf");
    for (let i = 1; i <= 24; i++) {
      const cut = Math.floor((pdf.length * i) / 25);
      try {
        const pages = readPdfText(pdf.subarray(0, cut));
        // whatever comes back must still be handled by the table reader without throwing
        parsePtr(pages);
      } catch (e) {
        expect(e).toBeInstanceOf(PdfError);
      }
    }
  });

  it("reads a ToUnicode map with ranges, lists and chars", () => {
    const f = parseToUnicode("begincodespacerange <0000> <FFFF> endcodespacerange\nbeginbfchar <0003> <0020> <0011> <002E> endbfchar\nbeginbfrange <0024> <0026> <0041> <0030> <0031> [<0058> <0059>] endbfrange", 2);
    expect(f.width).toBe(2);
    expect(f.map?.get(3)).toBe(" ");
    expect(f.map?.get(0x25)).toBe("B");
    expect(f.map?.get(0x30)).toBe("X");
    expect(f.map?.get(0x31)).toBe("Y");
  });
});

describe("the snapshot the browser specs run on", () => {
  it("is what the reader makes of the fixture PDFs (CONGRESS_SNAPSHOT_WRITE=1 rewrites it after the reader changed)", () => {
    // the Playwright project cannot import server code, so `tests/e2e/mocks/congress.ts` reads this file; this test keeps it from drifting
    const ids = ["20035143", "20035408", "20035024", "20034694"];
    const snap = Object.fromEntries([...ids.map((id) => [id, reportOfPdf(id, 2026, file(`${id}.pdf`), 0)] as const), ["9000001", reportOfPdf("9000001", 2026, SCAN_PDF, 0)] as const]);
    const path = join(FIX, "reports.json");
    if (process.env["CONGRESS_SNAPSHOT_WRITE"] === "1") writeFileSync(path, `${JSON.stringify(snap)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(JSON.parse(JSON.stringify(snap)));
  });
});
