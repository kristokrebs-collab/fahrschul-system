/**
 * Shared pieces of the Congress tests: the real fixtures of the House Clerk, a mocked Clerk (`fetch`) that serves them, a small
 * index ZIP built around chosen members, and a tiny PDF in the structure of a scanned paper filing. Not a test file itself.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/congress");
export const fixture = (name: string): Buffer => readFileSync(join(FIX, name));

export const LAST_MODIFIED = "Fri, 23 Oct 2026 13:00:28 GMT";

export const reply = (body: Buffer | string, status = 200, headers: Record<string, string> = {}): Response => new Response(new Uint8Array(typeof body === "string" ? Buffer.from(body) : body), { status, headers });

/** a tiny PDF in the structure of a scanned paper filing: an object stream, page images, no font */
export const SCAN_PDF = Buffer.from("%PDF-1.5\n1 0 obj\n<< /Type /ObjStm /N 1 /First 8 /Length 4 >>\nstream\n0 0 \nendstream\nendobj\n2 0 obj\n<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /Length 2 >>\nstream\n\u0000\u0000\nendstream\nendobj\ntrailer\n<< /Root 3 0 R >>\n%%EOF\n", "latin1");

/** a ZIP (stored, one entry `<year>FD.xml`) around some text */
export function zipOf(text: string, name = "2026FD.xml"): Buffer {
  const data = Buffer.from(text);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12);
  end.writeUInt32LE(30 + n.length + data.length, 16);
  return Buffer.concat([local, n, data, central, n, end]);
}

export interface IndexMember {
  last: string;
  first: string;
  district: string;
  /** `M/D/YYYY` */
  filed: string;
  docId: string;
  type?: string;
}
export const member = (m: IndexMember): string =>
  `<Member><Prefix>Hon.</Prefix><Last>${m.last}</Last><First>${m.first}</First><Suffix /><FilingType>${m.type ?? "P"}</FilingType><StateDst>${m.district}</StateDst><Year>2026</Year><FilingDate>${m.filed}</FilingDate><DocID>${m.docId}</DocID></Member>`;
export const indexXml = (members: readonly IndexMember[]): string => `<?xml version="1.0" encoding="utf-8"?>\n<FinancialDisclosure>${members.map(member).join("\n")}</FinancialDisclosure>`;

/** The reports of the fixtures with the members and filing days the real 2026 index lists for them. */
export const FIXTURE_MEMBERS: Record<string, IndexMember> = {
  "20035143": { last: "Pelosi", first: "Nancy", district: "CA11", filed: "8/21/2026", docId: "20035143" },
  "20035408": { last: "Delaney", first: "April McClain", district: "MD06", filed: "9/9/2026", docId: "20035408" },
  "20034694": { last: "Lee", first: "Laurel", district: "FL15", filed: "7/19/2026", docId: "20034694" },
  "20034999": { last: "Wasserman Schultz", first: "Debbie", district: "FL25", filed: "7/14/2026", docId: "20034999" },
  "20035024": { last: "Crenshaw", first: "Daniel", district: "TX02", filed: "7/16/2026", docId: "20035024" },
};

/** Clerk mock: the real index ZIP (or `zip`), the PDFs of the fixtures by document number, 404 for the rest. `extra` answers URLs that contain a key. */
export function clerkMock(o: { zip?: Buffer; extra?: Record<string, () => Response | Promise<Response>> } = {}) {
  const zip = o.zip ?? fixture("2026FD.zip");
  return vi.fn(async (url: string | URL | Request): Promise<Response> => {
    const u = String(url);
    for (const [k, fn] of Object.entries(o.extra ?? {})) if (u.includes(k)) return fn();
    if (u.endsWith("2026FD.zip")) return reply(zip, 200, { "content-type": "application/x-zip-compressed", "last-modified": LAST_MODIFIED });
    const m = /ptr-pdfs\/(\d{4})\/(\d+)\.pdf$/.exec(u);
    if (m && FIXTURE_MEMBERS[m[2]!]) return reply(fixture(`${m[2]}.pdf`), 200, { "content-type": "application/pdf" });
    return reply("Not found", 404);
  });
}
