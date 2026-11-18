// @vitest-environment node
/// <reference types="node" />
/**
 * Launch-Audit D1 guards (`docs/audit/`): what stays true after the audit was written.
 *
 *   - Source: no link without a target (`href="#"`, `href=""`, `javascript:`), every `target="_blank"` carries `noopener` or `noreferrer`
 *     (the latter implies the former), every `window.open` passes `noopener`. These were P0 in the order ("Fake-Buttons ohne Handler
 *     und Links mit # sind P0") and are clean today; the test keeps them clean.
 *   - `INTERACTION_AUDIT.csv`: the ten columns of the order in that order, ten cells in every row, only the four allowed priorities (a
 *     repaired defect keeps its class and says "(repariert)"), semicolon dialect with quotes.
 *   - `STATUS.md`: says NO-GO as long as the operator accesses are missing, and claims no legal verdict.
 * It cannot say whether a row of the CSV is TRUE – that is the reader's job (the Nachweis column names the run and the manual check).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../.."); // trading-journal/

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
const SOURCES = walk(join(ROOT, "src")).map((p) => ({ p: p.slice(ROOT.length + 1), text: readFileSync(p, "utf8") }));

describe("links in the source (Launch-Audit D1)", () => {
  it("no link without a target: no href=\"#\", href=\"\" or javascript:", () => {
    const bad: string[] = [];
    for (const s of SOURCES) for (const m of s.text.matchAll(/href=(?:"#"|""|\{"#"\}|\{''\}|'#'|"javascript:)/g)) bad.push(`${s.p}:${s.text.slice(0, m.index).split("\n").length}`);
    expect(bad).toEqual([]);
  });

  it("every anchor that opens a new tab carries rel=noopener or rel=noreferrer (noreferrer implies noopener)", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const s of SOURCES)
      for (const m of s.text.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gs)) {
        seen++;
        // `rel={link.rel}` (partner links) is checked where the object is made
        if (!/noopener|noreferrer|rel=\{/.test(m[0])) bad.push(`${s.p}:${s.text.slice(0, m.index).split("\n").length}`);
      }
    expect(seen).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  it("window.open always passes noopener", () => {
    const bad: string[] = [];
    for (const s of SOURCES) for (const m of s.text.matchAll(/window\.open\([^)]*\)/g)) if (!/noopener/.test(m[0])) bad.push(`${s.p}:${s.text.slice(0, m.index).split("\n").length}`);
    expect(bad).toEqual([]);
  });
});

/** Semicolon CSV with double quotes ("" escapes). */
function parseCsv(text: string): string[][] {
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
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const COLUMNS = ["Route", "Element/Button", "Erwartung", "aktueller Handler", "tatsächliches Network-/Backend-Ergebnis", "Fehler/Empty States", "Mobil/Keyboard", "Priorität", "Dateipfad", "Nachweis"];
const csvPath = join(ROOT, "docs/audit/INTERACTION_AUDIT.csv");

describe("docs/audit/INTERACTION_AUDIT.csv", () => {
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  it("has the ten columns of the order, in that order, and ten cells in every row", () => {
    expect(rows[0]).toEqual(COLUMNS);
    const odd = rows.slice(1).filter((r) => r.length !== COLUMNS.length);
    expect(odd.length).toBe(0);
    expect(rows.length).toBeGreaterThan(500);
  });
  it("uses only P0, P1, P2 and – (a repaired defect keeps its class and says „(repariert)“)", () => {
    const allowed = /^(P0|P1|P2)( \(repariert\))?$|^–$/;
    const bad = rows.slice(1).filter((r) => !allowed.test(r[7] ?? ""));
    expect(bad.map((r) => `${r[0]} | ${r[1]} | ${r[7]}`)).toEqual([]);
  });
  it("every page route is in it, and no click-dead row hides under „–“", () => {
    const routes = new Set(rows.slice(1).map((r) => r[0]));
    for (const p of ["overview", "trades", "plan", "setups", "markt", "aktien", "risiko", "analyse", "berichte", "coach", "wachstum", "cockpit", "labor", "studio", "settings", "konto", "community", "preise", "funktionen"]) expect(routes, p).toContain(`#${p}`);
    // a click-dead row may only be "–" when a person looked at it and wrote why (`MANUELL: …` in the Nachweis, `scripts/audit/annotations.json`)
    const hidden = rows.slice(1).filter((r) => r[7] === "–" && /dead-candidate/.test(`${r[4] ?? ""} ${r[5] ?? ""}`) && !/MANUELL:/.test(r[9] ?? ""));
    expect(hidden.map((r) => `${r[0]} | ${r[1]}`)).toEqual([]);
  });
});

describe("docs/audit/STATUS.md", () => {
  const text = readFileSync(join(ROOT, "docs/audit/STATUS.md"), "utf8");
  it("states NO-GO and the operator blockers, and says it is no release and no legal opinion", () => {
    expect(text).toMatch(/\*\*NO-GO\*\*/);
    expect(text).toMatch(/keine Freigabe und keine Rechtsaussage/);
    for (const needle of ["Supabase", "Stripe", "Impressum", "Geräte"]) expect(text, needle).toContain(needle);
  });
  it("claims no legal verdict", () => {
    expect(text).not.toMatch(/rechtssicher|rechtskonform|rechtskräftig|dsgvo-konform|abmahnsicher|garantiert rechtlich/i);
  });
});
