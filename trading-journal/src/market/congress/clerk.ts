/**
 * The House Clerk's public disclosure index: where it lives and how its XML is read. PURE (strings in, data out), alias-free –
 * the function reads the ZIP and fetches, this file only understands the text.
 *
 *   index   https://disclosures-clerk.house.gov/public_disc/financial-pdfs/<YEAR>FD.zip   (a ZIP holding <YEAR>FD.xml and .txt)
 *   report  https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/<YEAR>/<DocID>.pdf   (a Periodic Transaction Report)
 *
 * The XML is `<FinancialDisclosure><Member><Prefix/><Last/><First/><Suffix/><FilingType/><StateDst/><Year/><FilingDate/><DocID/>
 * </Member>…`. `FilingType` `P` is a Periodic Transaction Report (the others are annual reports, candidate reports, extensions,
 * withdrawals …). A file that has no `<Member>` at all, or none that can be read, is a CHANGED FORMAT, not an empty year:
 * `ClerkFormatError`.
 */
import { DOC_ID, type CongressFiling } from "./wire";

export const CLERK_ORIGIN = "https://disclosures-clerk.house.gov";
export const indexUrl = (year: number): string => `${CLERK_ORIGIN}/public_disc/financial-pdfs/${year}FD.zip`;
export const ptrUrl = (year: number, docId: string): string => `${CLERK_ORIGIN}/public_disc/ptr-pdfs/${year}/${docId}.pdf`;

export class ClerkFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClerkFormatError";
  }
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** `8/21/2026` → `2026-08-21`; anything that is not a real calendar day → `null`. */
export function isoOfMdy(text: string | null | undefined): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*$/.exec(text ?? "");
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (m[3]!.length === 2) year += 2000;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface ParsedIndex {
  /** Periodic Transaction Reports, newest filing first */
  filings: CongressFiling[];
  /** all `<Member>` entries (every filing type) */
  total: number;
}

const FIELD = /<(\w+)\s*\/>|<(\w+)>([\s\S]*?)<\/\2>/g;

/** The PTRs of a yearly index XML. Throws `ClerkFormatError` when it does not look like the Clerk's index. */
export function parseIndexXml(xml: string, year: number): ParsedIndex {
  const text = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml; // the Clerk writes a byte order mark
  if (!/<FinancialDisclosure[\s>]/.test(text)) throw new ClerkFormatError("Der Index hat nicht den erwarteten Aufbau (kein <FinancialDisclosure>).");
  const members = [...text.matchAll(/<Member>([\s\S]*?)<\/Member>/g)].map((m) => m[1]!);
  if (!members.length) throw new ClerkFormatError("Der Index enthält keine Einträge (<Member>) – der Aufbau der Datei hat sich vermutlich geändert.");
  const filings: CongressFiling[] = [];
  let readable = 0;
  for (const block of members) {
    const f: Record<string, string> = {};
    for (const m of block.matchAll(FIELD)) f[m[1] ?? m[2]!] = m[1] ? "" : decodeXml((m[3] ?? "").trim());
    const docId = f.DocID ?? "";
    if (!DOC_ID.test(docId) || !f.Last || !f.FilingType) continue;
    readable++;
    if (f.FilingType !== "P") continue;
    const y = /^\d{4}$/.test(f.Year ?? "") ? Number(f.Year) : year;
    const name = [f.First, f.Last, f.Suffix].filter(Boolean).join(" ");
    filings.push({ docId, year: y, name, last: f.Last, district: f.StateDst ?? "", filed: isoOfMdy(f.FilingDate), url: ptrUrl(y, docId) });
  }
  if (!readable) throw new ClerkFormatError("Kein Eintrag des Index ließ sich lesen – der Aufbau der Datei hat sich vermutlich geändert.");
  filings.sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? "") || b.docId.localeCompare(a.docId));
  return { filings, total: members.length };
}
