// @vitest-environment node
/// <reference types="node" />
/**
 * Launch audit documents of round 12 (package D2): `docs/audit/FUNCTION_AUDIT_74.csv` (the 74 functions F01–F74 with route, file, backend,
 * data source, plan, external approval, state, test and proof), `docs/audit/RELEASE_TEST_RESULTS.csv` (every case of the operator's
 * `QA_RELEASE_TESTS.csv` with result, proof and date) and `docs/audit/SKILLS_APPLIED.md` (the 71 skills, honestly). Like
 * `docs.abnahme.test.ts` this guards the SHAPE and the honesty of the references – it cannot say whether a row is TRUE:
 *   - FUNCTION_AUDIT: ids F01–F74 once each, the 11 columns, only the five states, every named path exists, the plan equals the UX matrix,
 *     code and test files come from COVERAGE.md, nothing is `live` without an end-to-end proof, nothing is `mock` without a named approval;
 *   - RELEASE_TEST_RESULTS: every row of the QA file present and unchanged (hash of its five columns), only PASS / FAIL / BLOCKED, the
 *     date, PASS names a test or a measurement that exists, BLOCKED names its blocker, FAIL names its place, cases that need a real
 *     provider are never PASS, the prices the cases expect (VIS-05 … 07) equal the code;
 *   - SKILLS_APPLIED: the 71 names of the inventory once each, the four states, the counts equal the rows, nothing is "im Branch" that is not.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LIST_PRICES } from "@/billing/plans";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../.."); // trading-journal/
const REPO = join(ROOT, "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** `;`-separated CSV with quotes, a leading BOM and CRLF – the format of the operator's QA file. */
function parseCsv(raw: string): string[][] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ";") {
      row.push(cell);
      cell = "";
    } else if (c === "\r") {
      /* part of CRLF */
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const PATH_RE = /\b(?:src|tests|netlify|docs|supabase|scripts|public|dev)\/[A-Za-z0-9_@./-]*[A-Za-z0-9_]/g;
const TOP_FILES = /\bnetlify\.toml\b/g;

function pathsIn(text: string): string[] {
  return [...new Set(text.match(PATH_RE) ?? [])];
}

function missingPaths(label: string, text: string): string[] {
  const out: string[] = [];
  for (const p of pathsIn(text)) if (!existsSync(join(ROOT, p))) out.push(`${label}: ${p}`);
  if (TOP_FILES.test(text) && !existsSync(join(REPO, "netlify.toml"))) out.push(`${label}: netlify.toml`);
  TOP_FILES.lastIndex = 0;
  return out;
}

const NO_VERDICT = /rechtssicher|rechtskonform|rechtskräftig|dsgvo-konform|abmahnsicher|garantiert rechtlich/i;

/* ------------------------------------------------------------------------------------------------ FUNCTION_AUDIT_74.csv */

const FUNCTION_HEADER = ["id", "Nutzerziel", "UI-Route", "Implementations-Datei", "Backend/API", "Datenquelle", "benötigter Tarif", "externe Freigabe", "Zustand (live/test/mock/kaputt/nicht vorhanden)", "Test-ID", "Nachweis"];
const STATES = ["live", "test", "mock", "kaputt", "nicht vorhanden"];

const functionRaw = read("docs/audit/FUNCTION_AUDIT_74.csv");
const functionRows = parseCsv(functionRaw).filter((r) => r.length > 1 || (r[0] ?? "") !== "");

/** COVERAGE.md: F-ID → { punkt, code paths, test paths } */
function coverage(): Map<string, { punkt: string; code: string[]; tests: string[] }> {
  const out = new Map<string, { punkt: string; code: string[]; tests: string[] }>();
  for (const l of read("docs/COVERAGE.md").split("\n")) {
    if (!/^\| F\d\d \|/.test(l)) continue;
    const c = l.split("|").map((x) => x.trim());
    out.set(c[1]!, { punkt: c[2]!, code: pathsIn(c[4]!), tests: pathsIn(c[6]!) });
  }
  return out;
}

/** UX-MATRIX-74.md: F-ID → plan cell */
function uxTarif(): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of read("docs/UX-MATRIX-74.md").split("\n")) {
    if (!/^\| F\d\d \|/.test(l)) continue;
    const cells = l.slice(2, -2).split(" | ");
    out.set(cells[0]!, cells[10]!);
  }
  return out;
}

describe("docs/audit/FUNCTION_AUDIT_74.csv", () => {
  const body = functionRows.slice(1);
  const ids = Array.from({ length: 74 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`);

  it("has the 11 columns of the order and one row per F01–F74, each id once and in order", () => {
    expect(functionRows[0]).toEqual(FUNCTION_HEADER);
    expect(body).toHaveLength(74);
    expect(body.map((r) => r[0])).toEqual(ids);
    for (const r of body) {
      expect(r.length, `${r[0]}: Spalten`).toBe(FUNCTION_HEADER.length);
      r.forEach((c, i) => expect(c.trim().length, `${r[0]}: Spalte „${FUNCTION_HEADER[i]}“ leer`).toBeGreaterThan(0));
    }
  });

  it("uses only the five states; nothing is `live` without an end-to-end proof, nothing `kaputt` or `nicht vorhanden` without a reason", () => {
    for (const r of body) {
      expect(STATES, `${r[0]}: Zustand`).toContain(r[8]);
      if (r[8] === "live") expect(r[10], `${r[0]}: live braucht den Ende-zu-Ende-Beleg`).toMatch(/Ende-zu-Ende/);
      if (r[8] === "kaputt" || r[8] === "nicht vorhanden") expect(r[10], `${r[0]}: ${r[8]} braucht eine Fundstelle`).toMatch(/Fundstelle:/);
    }
  });

  it("is honest about mocks: a `mock` row names the external approval it waits for, a `test` row says that no foreign service is in its core path", () => {
    for (const r of body) {
      if (r[8] === "mock") {
        expect(r[7], `${r[0]}: mock braucht eine Freigabe`).not.toBe("keine");
        expect(r[10], `${r[0]}`).toMatch(/Kein Lauf gegen den echten Dienst/);
      }
      if (r[8] === "test") expect(r[10], `${r[0]}`).toMatch(/Kein Betreiber-Dienst im Kernweg/);
    }
  });

  it("names only paths that exist (implementation, backend, tests and proof)", () => {
    const missing: string[] = [];
    for (const r of body) for (const col of [3, 4, 9, 10]) missing.push(...missingPaths(`${r[0]} ${FUNCTION_HEADER[col]}`, r[col]!));
    expect(missing).toEqual([]);
  });

  it("takes the files from COVERAGE.md, the plan from the UX matrix, the name from the register of the plan", () => {
    const cov = coverage();
    const tarif = uxTarif();
    expect(cov.size).toBe(74);
    for (const r of body) {
      const c = cov.get(r[0]!)!;
      expect(r[1], `${r[0]}: Bauplan-Punkt`).toContain(`Bauplan: ${c.punkt}`);
      const impl = pathsIn(r[3]!);
      expect(impl.length, `${r[0]}: Implementations-Datei`).toBeGreaterThan(0);
      expect(impl[0], `${r[0]}: erste Implementations-Datei`).toBe(c.code[0]);
      // the files COVERAGE lists for the point are all there (the column may add more: a flow COVERAGE does not name yet)
      expect(pathsIn(r[9]!), `${r[0]}: Test-ID enthält die Tests aus COVERAGE`).toEqual(expect.arrayContaining(c.tests));
      expect(r[6], `${r[0]}: Tarif`).toBe(tarif.get(r[0]!));
    }
  });

  it("gives every function at least one unit test and a route that starts with `#`", () => {
    for (const r of body) {
      expect(pathsIn(r[9]!).some((p) => p.startsWith("tests/unit/")), `${r[0]}: kein Unit-Test`).toBe(true);
      expect(r[2], `${r[0]}: Route`).toMatch(/^#[a-z]+/);
    }
  });

  it("keeps the two known oddities of the original table visible (F55 unassigned in the catalogue, F50 and F71 under one name)", () => {
    const f55 = body.find((r) => r[0] === "F55")!;
    expect(f55[1]).toMatch(/Zuordnung offen/);
    expect(f55[1]).toMatch(/Klare mobile Oberfläche/);
    expect(body.find((r) => r[0] === "F71")![10]).toMatch(/F50 und F71 beide als/);
  });

  it("claims no legal verdict", () => {
    expect(functionRaw).not.toMatch(NO_VERDICT);
  });
});

/* ------------------------------------------------------------------------------------------- RELEASE_TEST_RESULTS.csv */

const QA_HEADER = ["ID", "Bereich", "Testschritt", "Erwartetes Ergebnis", "Priorität", "Ergebnis PASS/FAIL/BLOCKED", "Beleg/Screenshot/Commit", "Ausgeführt am"];
const QA_IDS = [
  "VIS-01", "VIS-02", "VIS-03", "VIS-04", "VIS-05", "VIS-06", "VIS-07", "VIS-08",
  "AUTH-01", "AUTH-02", "AUTH-03", "AUTH-04", "AUTH-05", "AUTH-06", "AUTH-07", "AUTH-08", "AUTH-09", "AUTH-10", "AUTH-11",
  "DATA-01", "DATA-02", "DATA-03", "DATA-04",
  "BILL-01", "BILL-02", "BILL-03", "BILL-04", "BILL-05", "BILL-06", "BILL-07", "BILL-08", "BILL-09", "BILL-10", "BILL-11", "BILL-12",
  "TRADE-01", "TRADE-02", "TRADE-03", "TRADE-04", "TRADE-05", "TRADE-06", "TRADE-07", "TRADE-08", "TRADE-09", "TRADE-10",
  "CONN-01", "CONN-02", "CONN-03", "CONN-04",
  "OPS-01", "OPS-02", "OPS-03",
  "UI-01", "UI-02", "UI-03", "UI-04", "UI-05", "UI-06", "UI-07", "UI-08",
  "PERF-01", "PERF-02", "SEC-01", "SEC-02", "LEGAL-01", "LEGAL-02", "REL-01", "REL-02", "REL-03",
];
/** sha256 over `ID;Bereich;Testschritt;Erwartetes Ergebnis;Priorität` of the 69 rows of the operator's `QA_RELEASE_TESTS.csv`, joined by `\n` – the cases are theirs and stay as they were. */
const QA_SOURCE_SHA256 = "07375f276506bb821063141886634cdae5b8749e7a121d4aa71cd34d2fe3fb4f";
const RESULTS = ["PASS", "FAIL", "BLOCKED"];
/** Cases whose expected result needs a real provider, account, device or lawyer: they are BLOCKED or FAIL, never PASS on a mock. */
const NEVER_PASS = [
  "AUTH-01", "AUTH-04", "AUTH-05", "AUTH-07", "AUTH-08", "AUTH-09", "AUTH-10", "AUTH-11",
  "DATA-01", "DATA-02", "DATA-03", "DATA-04",
  "BILL-01", "BILL-02", "BILL-03", "BILL-04", "BILL-05", "BILL-06", "BILL-07", "BILL-08", "BILL-09", "BILL-10", "BILL-11",
  "VIS-05", "VIS-06", "VIS-07",
  "CONN-01", "CONN-02", "CONN-03", "CONN-04", "OPS-01", "OPS-03", "TRADE-06", "TRADE-08", "UI-05", "UI-07", "PERF-01", "SEC-02", "LEGAL-01", "REL-01", "REL-02", "REL-03",
];

const qaRaw = read("docs/audit/RELEASE_TEST_RESULTS.csv");
const qaRows = parseCsv(qaRaw).filter((r) => r.length > 1 || (r[0] ?? "") !== "");

describe("docs/audit/RELEASE_TEST_RESULTS.csv", () => {
  const body = qaRows.slice(1);
  const byId = new Map(body.map((r) => [r[0]!, r]));

  it("keeps the header of the QA file and holds every one of its 69 cases, unchanged", () => {
    expect(qaRows[0]).toEqual(QA_HEADER);
    expect(body.map((r) => r[0])).toEqual(QA_IDS);
    for (const r of body) expect(r.length, `${r[0]}: Spalten`).toBe(QA_HEADER.length);
    const text = body.map((r) => r.slice(0, 5).join(";")).join("\n");
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(QA_SOURCE_SHA256);
  });

  it("fills result, proof and date in every row: PASS / FAIL / BLOCKED and 2026-11-08", () => {
    for (const r of body) {
      expect(RESULTS, `${r[0]}: Ergebnis`).toContain(r[5]);
      expect(r[6]!.trim().length, `${r[0]}: Beleg leer`).toBeGreaterThan(40);
      expect(r[7], `${r[0]}: Datum`).toBe("2026-11-08");
    }
  });

  it("PASS names a test or a measurement that exists; BLOCKED names its blocker; FAIL names where it fails", () => {
    for (const r of body) {
      const proof = r[6]!;
      if (r[5] === "PASS") {
        expect(pathsIn(proof).some((p) => p.startsWith("tests/") || p.startsWith("scripts/")), `${r[0]}: PASS ohne Test oder Messung`).toBe(true);
        expect(proof, `${r[0]}: PASS mit Blocker`).not.toMatch(/Blocker:/);
      }
      if (r[5] === "BLOCKED") expect(proof, `${r[0]}: BLOCKED ohne Blocker`).toMatch(/Blocker:/);
      if (r[5] === "FAIL") expect(proof, `${r[0]}: FAIL ohne Fundstelle`).toMatch(/Fundstelle:/);
    }
  });

  it("never lets a case that needs a real provider, account, device or lawyer pass on a mock", () => {
    for (const id of NEVER_PASS) expect(byId.get(id)![5], id).not.toBe("PASS");
  });

  it("names only paths that exist, and every quoted test title (path (… „title“)) is really in that file", () => {
    const missing: string[] = [];
    const wrong: string[] = [];
    let checked = 0;
    for (const r of body) {
      missing.push(...missingPaths(r[0]!, r[6]!));
      for (const m of r[6]!.matchAll(/(tests\/[\w./@-]+\.tsx?)(?: \([^()]*\))? \(((?:„[^“]*“(?:, )?)+)\)/g)) {
        const file = join(ROOT, m[1]!);
        if (!existsSync(file)) continue;
        const src = readFileSync(file, "utf8");
        for (const t of m[2]!.matchAll(/„([^“]*)“/g)) {
          const prefix = t[1]!.replace(/…$/, "");
          checked++;
          if (!src.includes(prefix)) wrong.push(`${r[0]}: ${m[1]} → „${prefix}“`);
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
    expect(missing).toEqual([]);
    expect(wrong).toEqual([]);
  });

  it("the prices the cases expect (Pro 120 €, Premium 240 €, Team 2 seats 380 €) are the prices of the code", () => {
    expect(LIST_PRICES.pro.year).toBe(12000);
    expect(LIST_PRICES.premium.year).toBe(24000);
    expect(LIST_PRICES.team.year * 2).toBe(38000);
    expect(byId.get("VIS-05")![6]).toContain("12000 Cent");
    expect(byId.get("VIS-06")![6]).toContain("24000 Cent");
    expect(byId.get("VIS-07")![6]).toContain("38000");
    expect(byId.get("VIS-07")![6]).toContain("19000 Cent");
  });

  it("states its verdict in REL-03: no start while a P0 case is open, and claims no legal verdict", () => {
    expect(byId.get("REL-03")![6]).toMatch(/NO-GO/);
    expect(qaRaw).not.toMatch(NO_VERDICT);
  });
});

/* ------------------------------------------------------------------------------------------------ SKILLS_APPLIED.md */

const SKILLS = [
  "agent-chief-of-staff", "algorithmic-art", "b2b-lead-research", "befehlskarte", "browser-visual-qa", "canvas-design", "content-operating-system", "conversion-psychology",
  "crm-intake-booking", "dcf", "design-art-direction", "design-system-generator", "extract-design", "fish-audio", "fish-audio-api", "fish-audio-sdk", "fresh-eyes-critic",
  "frontend-design", "frontend-motion-system", "german-website-compliance", "gsap-core", "gsap-frameworks", "gsap-performance", "gsap-plugins", "gsap-react", "gsap-scrolltrigger",
  "gsap-timeline", "gsap-utils", "hyper-stack", "industry-trend-lab", "llm-council", "local-business-rebuild", "magic-ui", "meta-ad-research", "morning-note", "motionsites-web-builder",
  "opportunity-monitor", "outbound-approval", "photo-video-tours", "playwright-cli", "private-data-file-uploads", "pulse-motion", "responsive-design", "silent-ugc", "silent-ugc-workflow",
  "slack-gif-creator", "social-carousel-publishing", "social-drafts", "spar-befehle", "taste-skill", "trader-alerts", "trader-analyst", "trader-broker", "trader-budget", "trader-entry",
  "trader-exit", "trader-news", "trader-pelosi", "trader-risk", "trader-scanner", "trader-timemachine", "trading-desk", "trading-lab", "ui-ux-pro-max", "uiverse-lookup",
  "video-reels-editing", "voice-reception", "web-design-guidelines", "webapp-testing", "website-security-audit", "whatsapp-client-agent",
];
const SKILL_STATES = ["angewendet (belegt)", "nur erwähnt", "vorhanden, nicht angewendet", "nicht installiert"];

describe("docs/audit/SKILLS_APPLIED.md", () => {
  const text = read("docs/audit/SKILLS_APPLIED.md");
  const cells = (l: string): string[] => l.split("|").slice(1, -1).map((c) => c.trim());
  const rows = text.split("\n").filter((l) => /^\| \d+ \| `/.test(l)).map(cells);

  it("lists the 71 skills of the inventory once each, in the inventory's order, with seven columns", () => {
    expect(SKILLS).toHaveLength(71);
    expect(rows).toHaveLength(71);
    expect(rows.map((r) => r[1]!.replace(/`/g, ""))).toEqual(SKILLS);
    expect(rows.map((r) => Number(r[0]))).toEqual(Array.from({ length: 71 }, (_, i) => i + 1));
    for (const r of rows) {
      expect(r.length, r[1]).toBe(7);
      r.forEach((c) => expect(c.length).toBeGreaterThan(0));
    }
  });

  it("uses only the four states and the count table equals the rows", () => {
    for (const r of rows) expect(SKILL_STATES, r[1]).toContain(r[5]);
    const counted = new Map(SKILL_STATES.map((s) => [s, rows.filter((r) => r[5] === s).length]));
    for (const [state, n] of counted) {
      const line = text.split("\n").find((l) => l.startsWith(`| ${state} |`));
      expect(line, state).toBeDefined();
      expect(Number(cells(line!)[1]), state).toBe(n);
    }
    expect([...counted.values()].reduce((a, b) => a + b, 0)).toBe(71);
  });

  it("says „im Branch“ only for what the branch really holds, and „angewendet“ never for a skill that is nowhere", () => {
    const folder = existsSync(join(REPO, ".claude/skills"));
    for (const r of rows) {
      if (!folder) expect(r[3], `${r[1]}: im Branch`).toBe("nein");
      if (r[4] === "nein") expect(r[5], `${r[1]}`).toBe("nicht installiert");
      if (r[5] === "nicht installiert") expect(r[4], `${r[1]}`).toBe("nein");
    }
  });

  it("names only paths that exist where it points at the code, the docs and the tests of this branch", () => {
    const missing: string[] = [];
    for (const r of rows) missing.push(...missingPaths(r[1]!, r[6]!));
    expect(missing).toEqual([]);
  });

  it("states that the ZIP is missing and that nothing is claimed as installed; no legal verdict", () => {
    expect(text).toMatch(/liegt in dieser Sitzung nicht vor/);
    expect(text).toMatch(/nicht installiert/);
    expect(text).not.toMatch(NO_VERDICT);
  });
});
