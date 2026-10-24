/**
 * `docs/UEBERSICHT.md` – the map "Aufgabe → Seite → Abschnitt" – is generated from the function register: the table between the
 * two markers must be exactly what the register says today. A new or changed function therefore shows up here as a failing
 * line; `UEBERSICHT_WRITE=1 npx vitest run tests/unit/features.overview.test.ts` rewrites the table.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAGE_LABELS } from "@/app/Dock";
import { groupFeatures, subGroups } from "@/app/featureQuery";
import { FEATURE_REGISTRY, type FeatureEntry } from "@/app/features";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "../../docs/UEBERSICHT.md");
const START = "<!-- karte:start (erzeugt aus src/app/features.ts – nicht von Hand ändern) -->";
const END = "<!-- karte:end -->";

const cell = (s: string): string => s.replace(/\|/g, "/");

function where(f: FeatureEntry): string {
  const page = PAGE_LABELS[f.page];
  if (f.place) return `${page} › ${f.place}`;
  if (f.action) return `${page} (Fenster: ${f.action})`;
  return f.path ? `${page} – ${f.path}` : page;
}

/** The table of all functions, group by group, under their sub headings. */
function overviewTable(): string {
  const out: string[] = [];
  for (const { group, items } of groupFeatures(FEATURE_REGISTRY)) {
    out.push(`### ${group.name}`, "", `_${group.lead}_ · ${items.length} Funktionen`, "");
    for (const sg of subGroups(items)) {
      if (sg.sub) out.push(`**${sg.sub}**`, "");
      out.push("| Aufgabe | Funktion | Seite › Abschnitt | Stand |", "|---|---|---|---|");
      for (const f of sg.items) out.push(`| ${cell(f.task ?? "")} | ${cell(f.name)} | ${cell(where(f))} | ${f.status === "fertig" ? "fertig" : "teilweise"} |`);
      out.push("");
    }
  }
  return out.join("\n");
}

describe("docs/UEBERSICHT.md", () => {
  it("holds the map exactly as the register says it today", () => {
    const text = readFileSync(FILE, "utf8");
    const a = text.indexOf(START);
    const b = text.indexOf(END);
    expect(a, "start marker").toBeGreaterThan(-1);
    expect(b, "end marker").toBeGreaterThan(a);
    const table = `${overviewTable()}\n`;
    if (process.env.UEBERSICHT_WRITE) {
      writeFileSync(FILE, `${text.slice(0, a + START.length)}\n\n${table}${text.slice(b)}`);
      return;
    }
    expect(text.slice(a + START.length, b).trim()).toBe(table.trim());
  });

  it("names every function once", () => {
    const text = readFileSync(FILE, "utf8");
    for (const f of FEATURE_REGISTRY) expect(text, f.id).toContain(`| ${cell(f.name)} |`);
  });
});
