/**
 * `docs/UX-MATRIX-74.md` (A8): one row per point F01–F74 with the 14 columns, grouped by goal. The columns that come from the code
 * (Funktion, Aufgabe, Tarif, Ort in der App, Status) are held against it here – a changed register entry, plan or COVERAGE row
 * makes the line fail; the columns written by hand (Start, Eingaben, Ergebnis, nächster Schritt, Zustände) must not be empty,
 * and every "Vereinfachung" it points at must exist in the lists below the table.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEATURE_REGISTRY } from "@/app/features";
import { PAGE_LABELS } from "@/app/navGroups";
import { GOAL_NAME, LIMIT_INFO, PLAN_CATALOG } from "@/billing/plans";
import { fullPlanOf, FUNCTION_IDS, FUNCTION_TARIFF, startPlanOf } from "@/billing/tariff";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const text = readFileSync(join(ROOT, "docs/UX-MATRIX-74.md"), "utf8");

const COLUMNS = ["F-ID", "Funktion", "Aufgabe", "Nutzen", "Start", "Voraussetzungen", "Minimale Eingaben", "Ergebnis", "Nächster Schritt", "Zustände", "Tarif", "Ort in der App", "Status (ehrlich)", "Vereinfachung"];

interface Row {
  goal: string;
  cells: string[];
}

function rows(): Row[] {
  const out: Row[] = [];
  let goal = "";
  for (const line of text.split("\n")) {
    const h = /^### (.+)$/.exec(line);
    if (h) goal = h[1]!;
    if (/^\| F\d\d \|/.test(line)) out.push({ goal, cells: line.slice(2, -2).split(" | ") });
  }
  return out;
}

const NAME = (id: "free" | "pro" | "premium" | "team"): string => PLAN_CATALOG[id].name;
const PLANNED = new Set(["tvConnections", "alertChannels", "phoneCallsPerMonth", "simulationsPerDay"]);

const tarifOf = (fid: string): string => {
  const t = FUNCTION_TARIFF.find((x) => x.fid === fid)!;
  const start = NAME(startPlanOf(t));
  const full = NAME(fullPlanOf(t));
  const base = start === full ? (start === "Free" ? "Free" : `ab ${start}`) : start === "Free" ? `Free (vollständig ab ${full})` : `ab ${start} (vollständig ab ${full})`;
  return t.limits.length ? `${base} · Kontingent: ${t.limits.map((k) => LIMIT_INFO[k].label + (PLANNED.has(k) ? " (geplant)" : "")).join(", ")}` : base;
};

describe("docs/UX-MATRIX-74.md", () => {
  const all = rows();

  it("has one row for each of F01–F74 with the 14 columns, none empty", () => {
    expect(all.map((r) => r.cells[0]).sort()).toEqual([...FUNCTION_IDS].sort());
    const heads = text.split("\n").filter((l) => l.startsWith("| F-ID |"));
    expect(heads.length).toBeGreaterThan(5);
    for (const h of heads) expect(h.split(" | ").length, h).toBe(COLUMNS.length);
    for (const r of all) {
      expect(r.cells.length, r.cells[0]).toBe(COLUMNS.length);
      r.cells.forEach((c, i) => expect(c.trim().length, `${r.cells[0]}: column ${COLUMNS[i]} is empty`).toBeGreaterThan(0));
    }
  });

  it("groups the rows by goal, in the order of the day, under the goal's own name", () => {
    for (const r of all) {
      const t = FUNCTION_TARIFF.find((x) => x.fid === r.cells[0])!;
      expect(r.goal, r.cells[0]).toBe(GOAL_NAME[t.goal]);
      expect(r.cells[1], r.cells[0]).toBe(t.name);
    }
  });

  it("states the plan exactly as the tariff contract says it (start, complete, quotas)", () => {
    for (const r of all) expect(r.cells[10], r.cells[0]).toBe(tarifOf(r.cells[0]!));
  });

  it("takes task and place from the register, the status from COVERAGE.md", () => {
    const cov = new Map<string, { status: string }>();
    for (const l of readFileSync(join(ROOT, "docs/COVERAGE.md"), "utf8").split("\n").filter((x) => /^\| F\d\d \|/.test(x))) {
      const c = l.split("|").map((x) => x.trim());
      cov.set(c[1]!, { status: c[3]! });
    }
    for (const r of all) {
      const fid = r.cells[0]!;
      const ents = FEATURE_REGISTRY.filter((f) => f.fids.includes(fid)).sort((a, b) => (a.fids[0] === fid ? 0 : 1) - (b.fids[0] === fid ? 0 : 1));
      expect(r.cells[2], `${fid}: task`).toContain(ents[0]!.task!);
      expect(r.cells[11], `${fid}: place`).toContain(PAGE_LABELS[ents[0]!.page]);
      expect(r.cells[12]!.startsWith(`${cov.get(fid)!.status}:`), `${fid}: status`).toBe(true);
    }
  });

  it("does not embellish: a 'teilweise' point names what is missing, and the first words of the status are never 'fertig' for it", () => {
    for (const r of all) {
      const status = r.cells[12]!;
      if (status.startsWith("teilweise")) expect(status.length, r.cells[0]).toBeGreaterThan(40);
      expect(status, r.cells[0]).not.toMatch(/\b(garantiert|sicher gewinn|ohne Risiko)\b/i);
    }
  });

  it("points only at simplifications that exist, and lists the open ones", () => {
    const defined = new Set([...text.matchAll(/^\| (V\d+) \|/gm)].map((m) => m[1]));
    for (const r of all) for (const v of r.cells[13]!.match(/V\d+/g) ?? []) expect(defined.has(v), `${r.cells[0]}: ${v}`).toBe(true);
    for (const v of ["V1", "V2", "V3", "V4", "V5", "V6", "V11", "V15"]) expect(defined.has(v), v).toBe(true);
    expect(text).toMatch(/## Offene Liste/);
    expect(text).toMatch(/Nicht jede Zelle wurde im Browser durchgespielt/);
  });
});
