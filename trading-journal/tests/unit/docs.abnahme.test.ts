// @vitest-environment node
/// <reference types="node" />
/**
 * Welle D documents: `docs/ABNAHME-40.md` (40 acceptance points), `docs/PRODUKTABGLEICH.md` (target vs. actual in four columns) and
 * `docs/BETREIBER-AUFGABEN.md` (the operator's checklist). This test only guards the SHAPE and the honesty of the references – it cannot say
 * whether a row is TRUE (that is a reader's job):
 *   - ABNAHME: every number 1 … 40 exactly once, six cells, one of the four allowed statuses, the summary counts equal the counted rows;
 *   - PRODUKTABGLEICH: unique ids, exactly one ● per row (four columns), the summary counts equal the counted rows;
 *   - every file path named in backticks exists, and every quoted test title (`path` („title…“)) is really in that file;
 *   - no document claims a legal verdict; the drafts stay "Entwurf – Anwalt prüft"; the checklist names the migrations that exist.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../.."); // trading-journal/
const REPO = join(ROOT, "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

const ABNAHME = read("docs/ABNAHME-40.md");
const ABGLEICH = read("docs/PRODUKTABGLEICH.md");
const BETREIBER = read("docs/BETREIBER-AUFGABEN.md");

const STATUS = ["automatisch geprüft", "nur Mock", "von Hand/Gerät offen", "blockiert durch Betreiber-Konto"] as const;
const COLUMNS = ["fertig", "teilweise", "technisch blockiert", "bewusst nicht gebaut"] as const;
const TOTAL = 40;

function cellsOf(line: string): string[] {
  return line.split("|").slice(1, -1).map((c) => c.trim());
}

function tableRows(text: string): string[][] {
  return text.split("\n").filter((l) => l.startsWith("|")).map(cellsOf);
}

/** The lines of one `## …` section (without the heading). */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}`);
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.indexOf("\n## ", 4);
  return next < 0 ? rest : rest.slice(0, next);
}

const strip = (s: string): string => s.replace(/\*\*/g, "").replace(/`/g, "").trim();

describe("docs/ABNAHME-40.md", () => {
  const rows = tableRows(ABNAHME).filter((c) => /^\d+$/.test(c[0] ?? "") && c.length === 6);

  it("has the numbers 1 … 40 exactly once, each row with the six columns", () => {
    const seen = new Map<number, number>();
    for (const r of rows) seen.set(Number(r[0]), (seen.get(Number(r[0])) ?? 0) + 1);
    const missing = Array.from({ length: TOTAL }, (_, i) => i + 1).filter((n) => !seen.has(n));
    const doubled = [...seen].filter(([, c]) => c > 1).map(([n]) => n);
    expect({ missing, doubled }).toEqual({ missing: [], doubled: [] });
    expect(rows).toHaveLength(TOTAL);
    for (const r of rows) for (const c of r) expect(c, `row ${r[0]} has an empty cell`).not.toBe("");
  });

  it("gives every row one of the four statuses, written first in the status cell", () => {
    const wrong = rows.filter((r) => !STATUS.some((s) => strip(r[4]!).startsWith(s))).map((r) => `${r[0]}: ${strip(r[4]!).slice(0, 40)}`);
    expect(wrong).toEqual([]);
  });

  it("the summary table says what the rows say (counts and numbers)", () => {
    const counted = new Map<string, number[]>(STATUS.map((s) => [s, []]));
    for (const r of rows) counted.get(STATUS.find((s) => strip(r[4]!).startsWith(s))!)!.push(Number(r[0]));
    const summary = tableRows(section(ABNAHME, "Zusammenfassung")).filter((c) => STATUS.includes(c[0] as (typeof STATUS)[number]));
    expect(summary.map((c) => c[0])).toEqual([...STATUS]);
    for (const c of summary) {
      const nrs = counted.get(c[0]!)!;
      expect(Number(c[1]), `${c[0]}: Anzahl`).toBe(nrs.length);
      if (nrs.length > 0) expect(c[2]!.split(",").map((x) => Number(x.trim())), `${c[0]}: Nummern`).toEqual(nrs);
    }
    expect([...counted.values()].reduce((n, a) => n + a.length, 0)).toBe(TOTAL);
  });

  it("says in its head that the original definitions are missing and the operator reconciles with their own list", () => {
    expect(ABNAHME).toMatch(/Originaldefinitionen der 40 Abnahmetests/);
    expect(ABNAHME).toMatch(/abgeleitet aus dem Plan und aus dem Code/);
    expect(ABNAHME).toMatch(/Der Betreiber gleicht mit seiner eigenen Liste ab/);
  });

  it("nothing marked 'automatisch geprüft' is a row that names only a mock as its evidence in the status cell", () => {
    for (const r of rows.filter((x) => strip(x[4]!).startsWith("automatisch geprüft"))) {
      const head = strip(r[4]!).split(" — ")[0]!;
      expect(head, `row ${r[0]}`).not.toMatch(/\bMock\b|\bFake\b/);
    }
  });
});

describe("docs/PRODUKTABGLEICH.md", () => {
  const rows = tableRows(ABGLEICH).filter((c) => /^[A-Z]\d+[A-Z]?$/.test(c[0] ?? "") && c.length === 8);

  it("has unique ids and, in each row, exactly one ● in the four columns", () => {
    const ids = rows.map((r) => r[0]!);
    expect(new Set(ids).size, "doppelte Nr").toBe(ids.length);
    expect(rows.length).toBeGreaterThan(80);
    for (const r of rows) {
      const marks = r.slice(2, 6);
      expect(marks.filter((m) => m === "●").length, `${r[0]}: genau ein ●`).toBe(1);
      expect(marks.filter((m) => m !== "" && m !== "●"), `${r[0]}: nur ● oder leer`).toEqual([]);
      expect(r[6], `${r[0]}: Begründung`).not.toBe("");
      expect(r[7], `${r[0]}: Fundstelle`).not.toBe("");
    }
  });

  it("the summary counts equal the marked rows", () => {
    const counted = COLUMNS.map((_, i) => rows.filter((r) => r[2 + i] === "●").length);
    const summary = tableRows(section(ABGLEICH, "Zusammenfassung")).filter((c) => COLUMNS.includes(c[0] as (typeof COLUMNS)[number]));
    expect(summary.map((c) => c[0])).toEqual([...COLUMNS]);
    expect(summary.map((c) => Number(c[1]))).toEqual(counted);
    expect(counted.reduce((a, b) => a + b, 0)).toBe(rows.length);
  });

  it("carries the known open points and every audit finding of the list", () => {
    const text = ABGLEICH;
    for (const needle of [
      "126 px",
      "direkt bei Binance",
      "Re-Auth mit frischem Passwort",
      "Kartenfingerprint",
      "DeferredHosts",
      "captchaToken",
      "Cloud",
      "Standard-Schwellen",
      "Partnerlinks",
      "DACH/EU",
      "Entwurf – Anwalt prüft",
    ]) expect(text, needle).toContain(needle);
    for (const id of ["L1 #11", "L1 #12", "L1 #16", "L1 #17", "L1 #18", "L1 #20", "L1 #21", "L1 #22", "L1 #23", "L1 #24", "L1 #27", "L1 #28", "L3 #16", "L3 #19", "L3 #20", "L3 #21", "L3 #22", "L3 #23", "L3 #24", "L3 #25"]) {
      expect(text, id).toContain(id);
    }
  });
});

describe("docs/BETREIBER-AUFGABEN.md", () => {
  it("names the operator's tasks in the agreed order", () => {
    const order = ["## 1. Netlify-Site", "## 2. Supabase", "## 3. Netlify-Variablen", "## 4. Stripe", "## 5. Resend", "## 6. Twilio", "## 7. Anthropic", "## 8. Binance", "## 9. TradingView", "## 10. Deploy", "## 11. Geräte-Tests", "## 12. Anwalt", "## 13. Freigaben", "## 14. Aufbewahrungsfristen"];
    const at = order.map((h) => BETREIBER.indexOf(h));
    expect(at.filter((i) => i < 0), "fehlende Abschnitte").toEqual([]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("names the settings only the operator can make", () => {
    for (const needle of [
      "Anonyme Logins aus",
      "E-Mail-Bestätigung",
      "JWT-Laufzeit",
      "Upload-Limit",
      "SMTP",
      "CAPTCHA jetzt NICHT einschalten",
      "charge.refunded",
      "charge.dispute.created",
      "Planwechsel",
      "IP_HASH_PEPPER",
      "PHONE_HASH_KEY",
      "ALLOW_UNGATED",
      "KILL_SYNC",
      "Geo Permissions",
      "Fraud Guard",
      "Spend Limit",
      "TWILIO_VERIFY_SERVICE_SID",
      "ALERT_FROM",
      "BINANCE_EGRESS_IP",
      "TV_MCP_CLIENT_ID",
      "anwaltsfragen.md",
      "E8",
      "E10",
      "365 Tage",
      "30 Tage",
      "730 Tage",
    ]) expect(BETREIBER, needle).toContain(needle);
  });

  it("names the first and the last migration that exists (so the list cannot fall behind a new migration)", () => {
    const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    const last = /^(\d{4})_/.exec(files[files.length - 1]!)![1]!;
    expect(BETREIBER).toContain("0001");
    expect(BETREIBER, `die letzte Migration ${last}`).toContain(last);
  });
});

describe("all three documents", () => {
  const docs: [string, string][] = [["docs/ABNAHME-40.md", ABNAHME], ["docs/PRODUKTABGLEICH.md", ABGLEICH], ["docs/BETREIBER-AUFGABEN.md", BETREIBER]];

  it("never claim a legal verdict", () => {
    for (const [name, text] of docs) expect(text, name).not.toMatch(/rechtssicher|rechtskonform|rechtskräftig|dsgvo-konform|abmahnsicher|garantiert rechtlich/i);
  });

  it("every file path in backticks exists", () => {
    const top = new Set(["SETUP.md", "DESIGN.md", "playwright.config.ts", "package.json"]);
    const missing: string[] = [];
    for (const [name, text] of docs) {
      for (const m of text.matchAll(/`([^`\n]+)`/g)) {
        for (const raw of m[1]!.split(/\s+/)) {
          const tok = raw.replace(/[,;:.)]+$/, "");
          if (/^(tests|src|netlify|supabase|docs|scripts|dev|public)\/[\w./@-]+\.[a-z]+$/.test(tok) || top.has(tok)) {
            if (!existsSync(join(ROOT, tok))) missing.push(`${name}: ${tok}`);
          } else if (/^(\.github\/[\w./-]+\.[a-z]+|netlify\.toml)$/.test(tok)) {
            if (!existsSync(join(REPO, tok))) missing.push(`${name}: ${tok}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every quoted test title (`path` („title…“)) is really in that file", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const [name, text] of docs) {
      for (const m of text.matchAll(/`([^`\s]+\.(?:ts|tsx|mts|sql))`\s*\(((?:„[^“]*“(?:, )?)+)\)/g)) {
        const file = join(ROOT, m[1]!);
        if (!existsSync(file)) continue; // reported by the path test
        const src = readFileSync(file, "utf8");
        for (const t of m[2]!.matchAll(/„([^“]*)“/g)) {
          const prefix = t[1]!.replace(/…$/, "");
          checked++;
          if (!src.includes(prefix)) wrong.push(`${name}: ${m[1]} → „${prefix}“`);
        }
      }
    }
    expect(checked).toBeGreaterThan(80);
    expect(wrong).toEqual([]);
  });
});
